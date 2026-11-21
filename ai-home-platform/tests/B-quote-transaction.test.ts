import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { ProviderIdentity, Quote, QuoteSubmissionInput, envelope } from "../src/contracts";
import { createQuoteAtomically, QuoteWriteRejected, type QuoteTransactionSessionReader } from "../src/lib/quote-engine/transaction";
import { handleQuoteSubmission } from "../src/lib/quote-engine/submit-request";
import { POST } from "../src/app/api/quote/route";

const identity = ProviderIdentity.parse({ userId: "test-provider-user", role: "provider", providerId: "test-provider" });
const input = QuoteSubmissionInput.parse({ demandId: "test-demand", estimatedDays: 5, items: [
  { code: "a", name: "合成明细", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "" },
  { code: "b", name: "合成明细", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "" },
  { code: "c", name: "未知费用", unit: "piece", quantity: 1, unitPriceCents: null, note: "" },
  { code: "d", name: "零元明细", unit: "piece", quantity: 1, unitPriceCents: 0, note: "" },
] });
const request = (key = "test-quote-key-0001", value: unknown = input) => new Request("http://localhost/api/quote", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(value) });
const rejected = (status: number, code: string) => (error: unknown) => error instanceof QuoteWriteRejected && error.status === status && error.code === code;

test("原子报价内核使用隔离 SQLite 验证事务，不连接开发数据库", async (t) => {
  const tempRoot = resolve(tmpdir());
  const fixtureDir = mkdtempSync(join(tempRoot, "ai-home-B-quote-tx-"));
  const databasePath = join(fixtureDir, "quote-test.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect();
    const target = resolve(fixtureDir);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-B-quote-tx-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  // 使用现有 schema 建专用临时数据库，不改 schema、.env 或用户的开发数据库。
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
  });
  await db.user.createMany({ data: [
    { id: "test-owner", name: "Synthetic owner", role: "owner" },
    { id: identity.userId, name: "Synthetic provider user", role: "provider" },
  ] });
  const provider = { id: identity.providerId, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]", rating: 0 };
  await db.serviceProvider.create({ data: provider });
  await db.user.update({ where: { id: identity.userId }, data: { providerId: identity.providerId } });
  const demand = { id: input.demandId, ownerId: "test-owner", description: "Synthetic demand", city: "Test", areaM2: 10,
    budgetMinCents: 100, budgetMaxCents: 1000, renovationType: "repair", desiredDays: 5, status: "published" };
  await db.demandOrder.createMany({ data: [demand, { ...demand, id: "demo-demand" }] });

  // 合成会话仅供测试。特意使用传入 tx 读取角色，不能把此适配器当作真实登录。
  const readSession: QuoteTransactionSessionReader = async (_request, tx) => {
    const currentUser = await tx.user.findUnique({ where: { id: identity.userId } });
    return currentUser ? { ...identity, role: currentUser.role } : null;
  };
  const submit = (value: unknown = input, reader = readSession, key = "test-quote-key-0001") => createQuoteAtomically(request(key), value, identity, reader, db);
  const create = async (value: unknown = input, reader = readSession) => (await submit(value, reader)).quote;
  const clear = async () => { await db.quoteSubmissionReceipt.deleteMany(); await db.quote.deleteMany(); };
  const noQuotes = async () => { assert.equal(await db.quote.count(), 0); assert.equal(await db.quoteSubmissionReceipt.count(), 0); };

  await t.test("事务提交后返回公共 Quote，持久化逐行整数计价、null、零元和服务端身份", async () => {
    const result = Quote.parse(await create());
    assert.equal(result.status, "submitted");
    assert.equal(result.demandId, input.demandId);
    assert.equal(result.providerId, identity.providerId);
    assert.equal(result.source, "mock");
    assert.equal(result.knownTotalCents, 30);
    assert.deepEqual(result.items.map((item) => item.amountCents), [15, 15, null, 0]);
    assert.deepEqual(result.pendingItems, ["未知费用"]);
    const row = await db.quote.findUniqueOrThrow({ where: { id: result.id } });
    assert.deepEqual(JSON.parse(row.itemsJson), result.items);
    assert.deepEqual(JSON.parse(row.pendingItemsJson), result.pendingItems);
    assert.equal(row.knownTotalCents, 30);
    assert.equal(row.source, "mock");
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    await clear();
  });

  await t.test("即使预检曾通过，事务内会话丢失或异常也不写入", async () => {
    for (const reader of [async () => null, async () => { throw new Error("synthetic session expired"); }]) {
      await assert.rejects(create(input, reader), rejected(401, "UNAUTHENTICATED"));
      await noQuotes();
    }
  });

  await t.test("事务内身份必须仍是同一用户和服务方，换人、换绑、非服务方均拒绝", async () => {
    for (const current of [
      { ...identity, userId: "another-user" }, { ...identity, providerId: "another-provider" },
      { ...identity, role: "owner" }, { ...identity, providerId: null },
    ]) {
      await assert.rejects(create(input, async () => current), rejected(403, "FORBIDDEN"));
      await noQuotes();
    }
  });

  await t.test("事务数据库中的账户角色和服务方存在性不能用旧会话替代", async () => {
    await db.user.update({ where: { id: identity.userId }, data: { role: "owner" } });
    await assert.rejects(create(input, async () => identity), rejected(403, "FORBIDDEN"));
    await noQuotes();
    await db.user.update({ where: { id: identity.userId }, data: { role: "provider" } });
    await db.serviceProvider.delete({ where: { id: identity.providerId } });
    await assert.rejects(create(), rejected(403, "FORBIDDEN"));
    await noQuotes();
    await db.serviceProvider.create({ data: provider });
    await db.user.update({ where: { id: identity.userId }, data: { providerId: identity.providerId } });
  });

  await t.test("需求预检之后状态变化，事务内重读并拒绝所有非 published 状态", async () => {
    const preflight = await db.demandOrder.findUniqueOrThrow({ where: { id: input.demandId } });
    assert.equal(preflight.status, "published");
    for (const status of ["draft", "contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: input.demandId }, data: { status } });
      await assert.rejects(create(), rejected(409, "INVALID_STATE"));
      await noQuotes();
    }
    await db.demandOrder.update({ where: { id: input.demandId }, data: { status: "published" } });
  });

  await t.test("需求预检后删除返回 404；演示需求拒绝真实写入", async () => {
    assert.ok(await db.demandOrder.findUnique({ where: { id: input.demandId } }));
    await db.demandOrder.delete({ where: { id: input.demandId } });
    await assert.rejects(create(), rejected(404, "DEMAND_NOT_FOUND"));
    await noQuotes();
    await db.demandOrder.create({ data: demand });
    await assert.rejects(create({ ...input, demandId: "demo-demand" }), rejected(409, "DEMO_DEMAND_READ_ONLY"));
    await noQuotes();
  });

  await t.test("需求复核与身份适配器共用同一个事务，事务内状态变化可见且拒绝后一起回滚", async () => {
    await assert.rejects(create(input, async (req, tx) => {
      await tx.demandOrder.update({ where: { id: input.demandId }, data: { status: "contracted" } });
      return readSession(req, tx);
    }), rejected(409, "INVALID_STATE"));
    await noQuotes();
    assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: input.demandId } })).status, "published");
  });

  await t.test("特殊字符 ID 通过事务查询精确保存，不回退到演示需求", async () => {
    const id = "测试/a?b#c%20";
    await db.demandOrder.create({ data: { ...demand, id } });
    const result = await create({ ...input, demandId: id });
    assert.equal(result.demandId, id);
    assert.equal((await db.quote.findUniqueOrThrow({ where: { id: result.id } })).demandId, id);
    await clear();
  });

  await t.test("真实插入后若回执不符合契约，整个事务回滚且不返回成功", async () => {
    let inserted = false;
    const faultyDb = db.$extends({ query: { quote: { async create({ args, query }) {
      const row = await query(args);
      inserted = true;
      return { ...row, status: "invalid-output" };
    } } } });
    // Prisma 扩展会改变客户端泛型；这里只注入故障回执，事务仍由同一个真实 SQLite 客户端执行。
    await assert.rejects(createQuoteAtomically(request(), input, identity, readSession, faultyDb as unknown as Pick<PrismaClient, "$transaction">), ZodError);
    assert.equal(inserted, true);
    await noQuotes();
  });

  await t.test("数据库拒绝写入时事务失败，不把失败伪装成成功或自动重复写入", async () => {
    await db.$executeRawUnsafe('CREATE TRIGGER "reject_test_quote" BEFORE INSERT ON "Quote" BEGIN SELECT RAISE(ABORT, \'synthetic write rejection\'); END;');
    try {
      await assert.rejects(create());
      await noQuotes();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER "reject_test_quote";');
    }
  });

  await t.test("客户端伪造字段和金额溢出由公共契约拒绝，输入不被修改", async () => {
    const before = structuredClone(input);
    for (const value of [
      { ...input, providerId: "forged" }, { ...input, knownTotalCents: 0 },
      { ...input, items: [{ ...input.items[0], quantity: 2, unitPriceCents: Number.MAX_SAFE_INTEGER }] },
    ]) {
      await assert.rejects(create(value), ZodError);
      await noQuotes();
    }
    assert.deepEqual(input, before);
  });

  await t.test("校验时复制输入，异步认证期间改动原对象不会改变已计算的报价", async () => {
    const mutableInput = structuredClone(input);
    const mutableIdentity = structuredClone(identity);
    const { quote: result } = await createQuoteAtomically(request(), mutableInput, mutableIdentity, async (req, tx) => {
      mutableInput.demandId = "changed-after-validation";
      mutableInput.items[0].unitPriceCents = 999;
      mutableIdentity.providerId = "changed-after-validation";
      return readSession(req, tx);
    }, db);
    assert.equal(result.demandId, input.demandId);
    assert.equal(result.providerId, identity.providerId);
    assert.equal(result.knownTotalCents, 30);
    await clear();
  });

  await t.test("公开 POST 的默认认证仍拒绝未登录，客户端不能获得模拟登录或提交成功", async () => {
    const response = await POST(request());
    assert.equal(response.status, 401);
    assert.equal((await response.json()).ok, false);
    await noQuotes();
  });

  await t.test("同键规范化内容重放原报价，断开重连仍保持幂等", async () => {
    const first = await submit();
    assert.equal(first.replayed, false);
    await db.$disconnect();
    const replay = await submit({ ...input, items: input.items.map((item) => ({ ...item, name: ` ${item.name} ` })) });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.quote, first.quote);
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    await clear();
  });

  await t.test("同键不同内容返回 409，null 与零元不混同；不同键可建立新版本", async () => {
    const first = await submit();
    await assert.rejects(submit({ ...input, items: input.items.map((item) => item.unitPriceCents === null ? { ...item, unitPriceCents: 0 } : item) }), rejected(409, "IDEMPOTENCY_CONFLICT"));
    assert.equal(await db.quote.count(), 1);
    const second = await submit(input, readSession, "test-quote-key-0002");
    assert.notEqual(first.quote.id, second.quote.id);
    assert.equal(second.replayed, false);
    assert.equal(await db.quoteSubmissionReceipt.count(), 2);
    await clear();
  });

  await t.test("数据库换绑拒绝旧会话首次写入及重放，幂等键不能代替当前权限", async () => {
    await db.user.update({ where: { id: identity.userId }, data: { providerId: null } });
    await assert.rejects(submit(), rejected(403, "FORBIDDEN"));
    await noQuotes();
    await db.user.update({ where: { id: identity.userId }, data: { providerId: identity.providerId } });
    await submit();
    await db.user.update({ where: { id: identity.userId }, data: { providerId: null } });
    await assert.rejects(submit(), rejected(403, "FORBIDDEN"));
    assert.equal(await db.quote.count(), 1);
    await db.user.update({ where: { id: identity.userId }, data: { providerId: identity.providerId } });
    await db.demandOrder.update({ where: { id: input.demandId }, data: { status: "contracted" } });
    await assert.rejects(submit(), rejected(409, "INVALID_STATE"));
    await db.demandOrder.update({ where: { id: input.demandId }, data: { status: "published" } });
    await clear();
  });

  await t.test("不同服务方同键相互隔离，不返回其他服务方的回执", async () => {
    await db.serviceProvider.create({ data: { ...provider, id: "other-provider" } });
    const other = ProviderIdentity.parse({ ...identity, userId: "other-user", providerId: "other-provider" });
    await db.user.create({ data: { id: other.userId, name: "Synthetic other", role: "provider", providerId: other.providerId } });
    const first = await submit();
    const second = await createQuoteAtomically(request(), input, other, async () => other, db);
    assert.equal(second.replayed, false);
    assert.equal(second.quote.providerId, other.providerId);
    assert.notEqual(second.quote.id, first.quote.id);
    assert.equal(await db.quoteSubmissionReceipt.count(), 2);
    await clear();
  });

  await t.test("缺失/非法幂等键和超出数据库范围的金额/工期在写入前拒绝", async () => {
    for (const req of [new Request("http://localhost/api/quote"), request("short"), request("a".repeat(129))]) {
      await assert.rejects(createQuoteAtomically(req, input, identity, readSession, db), rejected(400, "VALIDATION_ERROR"));
    }
    for (const value of [
      { ...input, estimatedDays: 2_147_483_648 },
      { ...input, items: [{ ...input.items[0], quantity: 1, unitPriceCents: 2_147_483_648 }] },
      { ...input, items: [{ ...input.items[0], quantity: 1, unitPriceCents: 2_147_483_647 }, { ...input.items[1], quantity: 1, unitPriceCents: 1 }] },
    ]) await assert.rejects(submit(value), rejected(400, "VALIDATION_ERROR"));
    await noQuotes();
    const maximum = await submit({ ...input, estimatedDays: 2_147_483_647, items: [{ ...input.items[0], quantity: 1, unitPriceCents: 2_147_483_647 }] });
    assert.equal(maximum.quote.knownTotalCents, 2_147_483_647);
    await clear();
  });

  await t.test("回执插入失败时已插入的报价也回滚", async () => {
    await db.$executeRawUnsafe('CREATE TRIGGER "reject_receipt" BEFORE INSERT ON "QuoteSubmissionReceipt" BEGIN SELECT RAISE(ABORT, \'synthetic receipt failure\'); END;');
    try { await assert.rejects(submit()); await noQuotes(); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER "reject_receipt";'); }
  });

  await t.test("明确事务冲突重试整个事务并重新认证，最终只有一对报价和回执", async () => {
    let receiptAttempts = 0;
    let authAttempts = 0;
    const conflictDb = db.$extends({ query: { quoteSubmissionReceipt: { async create({ args, query }) {
      if (++receiptAttempts === 1) throw new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2034", clientVersion: "test" });
      return query(args);
    } } } });
    const result = await createQuoteAtomically(request(), input, identity, async (req, tx) => { authAttempts++; return readSession(req, tx); }, conflictDb as unknown as Pick<PrismaClient, "$transaction">);
    assert.equal(result.replayed, false);
    assert.equal(authAttempts, 2);
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    await clear();
  });

  await t.test("重试有上限，未知提交结果不自动重试或声明未保存", async () => {
    for (const code of ["P2034", "P2002", "P1017"]) {
      let attempts = 0;
      const failedDb = db.$extends({ query: { quoteSubmissionReceipt: { async create() {
        attempts++;
        throw new Prisma.PrismaClientKnownRequestError("synthetic failure", { code, clientVersion: "test" });
      } } } });
      await assert.rejects(createQuoteAtomically(request(), input, identity, readSession, failedDb as unknown as Pick<PrismaClient, "$transaction">));
      assert.equal(attempts, code === "P1017" ? 1 : 3);
      await noQuotes();
    }
  });

  await t.test("两个独立 SQLite 客户端并发同键提交只建立一份报价，另一个重放", async () => {
    const otherDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const results = await Promise.all([
        createQuoteAtomically(request(), input, identity, readSession, db),
        createQuoteAtomically(request(), input, identity, readSession, otherDb),
      ]);
      assert.equal(results[0].quote.id, results[1].quote.id);
      assert.equal(results.filter((result) => result.replayed).length, 1);
      assert.equal(await db.quote.count(), 1);
      assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    } finally { await otherDb.$disconnect(); await clear(); }
  });

  const auth = { readSession: async () => identity, readTransactionSession: readSession };
  const http = (value: unknown = input, key = "test-http-key-0001") => handleQuoteSubmission(request(key, value), auth, db);
  const failure = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, code);
    assert.equal("data" in body, false);
    assert.equal("meta" in body, false);
    return body;
  };

  await t.test("POST 处理器首次返回 201/mock，重新连接后同键规范化重放 200，仅有一份持久化记录", async () => {
    const first = await http();
    assert.equal(first.status, 201);
    const firstBody = envelope(Quote).parse(await first.json());
    assert.equal(firstBody.meta.source, "mock");
    assert.equal(firstBody.data.status, "submitted");
    assert.equal(firstBody.data.providerId, identity.providerId);
    assert.equal(firstBody.data.knownTotalCents, 30);
    assert.deepEqual(firstBody.data.items.map((row) => row.amountCents), [15, 15, null, 0]);
    await db.$disconnect();
    const replay = await http({ ...input, items: input.items.map((row) => ({ ...row, name: ` ${row.name} ` })) });
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), firstBody);
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    assert.equal((await db.quote.findUniqueOrThrow({ where: { id: firstBody.data.id } })).knownTotalCents, 30);
    await clear();
  });

  await t.test("reader 不能自行增加来源；合法重放使用原库来源，不升级 mock 或覆盖 live", async () => {
    const first = envelope(Quote).parse(await (await http()).json());
    const claimedAuth = {
      readSession: async () => ({ ...identity, source: "live" }),
      readTransactionSession: async () => ({ ...identity, source: "live" }),
    };
    await db.$disconnect();
    await failure(await handleQuoteSubmission(request("test-http-key-0001"), claimedAuth, db), 401, "UNAUTHENTICATED");
    const replay = await handleQuoteSubmission(request("test-http-key-0001"), { ...auth, readSession: async () => ({ ...identity }) }, db);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), first);
    assert.equal(first.data.source, "mock");
    // live 库记录仅用于测试历史来源透传，不能由当前演示认证创建。
    await db.quote.update({ where: { id: first.data.id }, data: { source: "live" } });
    const historical = await http();
    assert.equal(historical.status, 200);
    const body = envelope(Quote).parse(await historical.json());
    assert.equal(body.meta.source, "live");
    assert.deepEqual(body.data, { ...first.data, source: "live" });
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    await clear();
  });

  await t.test("创建明确写 mock；首次坏来源回滚，坏历史来源重放 500且不改原记录", async () => {
    for (const source of [undefined, null, "", "invalid-source"]) {
      const badOutput = db.$extends({ query: { quote: { async create({ args, query }) {
        assert.equal(args.data.source, "mock");
        return { ...await query(args), source } as never;
      } } } });
      await failure(await handleQuoteSubmission(request(), auth, badOutput as unknown as Pick<PrismaClient, "$transaction">), 500, "INTERNAL_ERROR");
      await noQuotes();
    }
    const first = envelope(Quote).parse(await (await http()).json());
    for (const source of ["", "LIVE", "invalid-source"]) {
      await db.quote.update({ where: { id: first.data.id }, data: { source } });
      await failure(await http(), 500, "INTERNAL_ERROR");
      assert.equal((await db.quote.findUniqueOrThrow({ where: { id: first.data.id } })).source, source);
      assert.equal(await db.quote.count(), 1);
      assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    }
    await clear();
  });

  await t.test("POST 保留幂等冲突优先级：需求已签约时不同内容仍为冲突，同内容为状态拒绝，历史记录保留", async () => {
    assert.equal((await http()).status, 201);
    await db.demandOrder.update({ where: { id: input.demandId }, data: { status: "contracted" } });
    const changed = { ...input, items: input.items.map((row) => row.unitPriceCents === null ? { ...row, unitPriceCents: 0 } : row) };
    await failure(await http(changed), 409, "IDEMPOTENCY_CONFLICT");
    await failure(await http(), 409, "INVALID_STATE");
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    await db.demandOrder.update({ where: { id: input.demandId }, data: { status: "published" } });
    assert.equal((await http(input, "test-http-key-0002")).status, 201);
    assert.equal(await db.quote.count(), 2);
    await clear();
  });

  await t.test("POST 事务内会话失效、换绑、缺失需求、模拟需求和非 published 状态均返回失败且不写库", async () => {
    await failure(await handleQuoteSubmission(request(), { ...auth, readTransactionSession: async () => null }, db), 401, "UNAUTHENTICATED");
    await db.user.update({ where: { id: identity.userId }, data: { providerId: null } });
    await failure(await http(), 403, "FORBIDDEN");
    await db.user.update({ where: { id: identity.userId }, data: { providerId: identity.providerId } });
    await failure(await http({ ...input, demandId: "absent-demand" }), 404, "DEMAND_NOT_FOUND");
    await failure(await http({ ...input, demandId: "demo-demand" }), 409, "DEMO_DEMAND_READ_ONLY");
    for (const status of ["draft", "contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: input.demandId }, data: { status } });
      await failure(await http(), 409, "INVALID_STATE");
    }
    await db.demandOrder.update({ where: { id: input.demandId }, data: { status: "published" } });
    await noQuotes();
  });

  await t.test("POST 坏需求数据或错位 ID 返回 500，坏报价输出不误归为输入 400且实际插入被回滚", async () => {
    for (const wrong of [{ status: "invalid-status" }, { id: "wrong-demand" }]) {
      const faultyDb = db.$extends({ query: { demandOrder: { async findUnique({ args, query }) {
        const row = await query(args);
        return row && { ...row, ...wrong };
      } } } });
      await failure(await handleQuoteSubmission(request(), auth, faultyDb as unknown as Pick<PrismaClient, "$transaction">), 500, "INTERNAL_ERROR");
      await noQuotes();
    }
    let inserted = false;
    const faultyDb = db.$extends({ query: { quote: { async create({ args, query }) {
      const row = await query(args);
      inserted = true;
      return { ...row, status: "invalid-status" };
    } } } });
    await failure(await handleQuoteSubmission(request(), auth, faultyDb as unknown as Pick<PrismaClient, "$transaction">), 500, "INTERNAL_ERROR");
    assert.equal(inserted, true);
    await noQuotes();
  });

  await t.test("POST 提交后丢失确认返回结果未知，不能声称未保存，同键重试返回已落库的原报价", async () => {
    let commits = 0;
    const lostAckDb = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      await db.$transaction(work, options);
      commits++;
      throw new Prisma.PrismaClientKnownRequestError("private commit acknowledgement lost", { code: "P1017", clientVersion: "test" });
    } } as unknown as Pick<PrismaClient, "$transaction">;
    const body = await failure(await handleQuoteSubmission(request("test-http-key-0001"), auth, lostAckDb), 500, "INTERNAL_ERROR");
    assert.ok(body.error.message.includes("无法确认"));
    assert.ok(!body.error.message.includes("未保存"));
    assert.ok(!body.error.message.includes("private"));
    assert.equal(commits, 1);
    assert.equal(await db.quote.count(), 1);
    assert.equal(await db.quoteSubmissionReceipt.count(), 1);
    const stored = await db.quote.findFirstOrThrow();
    const replay = await http();
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data.id, stored.id);
    assert.equal(await db.quote.count(), 1);
    await clear();
  });
});
