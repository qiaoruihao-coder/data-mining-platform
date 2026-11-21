import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { ProviderIdentity, Quote, QuoteSubmissionInput, envelope } from "../src/contracts";
import { readStoredQuoteComparison, QuoteReadDenied, type QuoteReadAuthorization } from "../src/lib/quote-engine/read";
import { createQuoteAtomically } from "../src/lib/quote-engine/transaction";
import { GET } from "../src/app/api/quote/route";

test("报价读取内核使用隔离 SQLite，授权适配器为测试夹具而非真实登录", async (t) => {
  const tempRoot = resolve(tmpdir());
  const fixtureDir = mkdtempSync(join(tempRoot, "ai-home-B-quote-read-"));
  const databasePath = join(fixtureDir, "read-test.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect();
    const target = resolve(fixtureDir);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-B-quote-read-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
  });
  await db.user.createMany({ data: [
    { id: "read-owner", name: "Synthetic owner", role: "owner" },
    { id: "other-owner", name: "Synthetic other", role: "owner" },
  ] });
  await db.serviceProvider.create({ data: { id: "read-provider", name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]", rating: 0 } });
  const identity = ProviderIdentity.parse({ userId: "read-provider-user", role: "provider", providerId: "read-provider" });
  await db.user.create({ data: { id: identity.userId, name: "Synthetic provider user", role: "provider", providerId: identity.providerId } });
  const demand = { id: "read-demand", ownerId: "read-owner", description: "Synthetic demand", city: "Test", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 1000, renovationType: "repair", desiredDays: 5, status: "published" };
  const specialId = "需求/a?b#c%20";
  await db.demandOrder.createMany({ data: [demand, { ...demand, id: "other-demand", ownerId: "other-owner" },
    { ...demand, id: "empty-demand" }, { ...demand, id: "demo-demand" }, { ...demand, id: specialId }] });
  const request = new Request("http://localhost/api/quote", { headers: { "Idempotency-Key": "read-core-key-0001" } });
  // 仅测试用授权：用指定的合成用户核验事务中的角色和 ownerId，不读取客户端身份提示。
  const ownerAuthorization: QuoteReadAuthorization = async (_request, id, tx) => {
    const user = await tx.user.findUnique({ where: { id: "read-owner" } });
    const current = await tx.demandOrder.findUnique({ where: { id } });
    return user?.role === "owner" && current?.ownerId === user.id;
  };
  const read = (id = demand.id, authorization = ownerAuthorization) => readStoredQuoteComparison(request, id, authorization, db);
  const item = { code: "line", name: "Synthetic item", unit: "job", quantity: 1, unitPriceCents: 100, amountCents: 100, note: "" };
  const row = { demandId: demand.id, providerId: identity.providerId, estimatedDays: 5, status: "submitted",
    itemsJson: JSON.stringify([item]), pendingItemsJson: "[]", knownTotalCents: 999 };
  const clear = async () => { await db.quoteSubmissionReceipt.deleteMany(); await db.quote.deleteMany(); };

  await t.test("原子写入后断开重连，读取同一报价 ID 和整数金额，保留 null 与零元", async () => {
    const input = QuoteSubmissionInput.parse({ demandId: demand.id, estimatedDays: 5, items: [
      { code: "a", name: "Half cent", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "" },
      { code: "b", name: "Half cent", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "" },
      { code: "c", name: "Unknown", unit: "job", quantity: 1, unitPriceCents: null, note: "" },
      { code: "d", name: "Zero", unit: "job", quantity: 1, unitPriceCents: 0, note: "" },
    ] });
    const saved = await createQuoteAtomically(request, input, identity, async () => identity, db);
    await db.$disconnect();
    const result = await read();
    assert.ok(result);
    assert.deepEqual(result.response, { ok: true, data: [saved.quote], meta: { source: "mock" } });
    assert.equal(result.demand.source, "live");
    assert.equal(result.response.data[0].knownTotalCents, 30);
    assert.deepEqual(result.response.data[0].items.map((value) => value.amountCents), [15, 15, null, 0]);
    assert.ok(envelope(Quote.array()).safeParse(result.response).success);
    await clear();
  });

  await t.test("数据库按需求和可见状态过滤，稳定 ID 顺序不合并同服务方报价，缓存合计不被信任", async () => {
    await db.quote.createMany({ data: [
      { ...row, id: "z-submitted" }, { ...row, id: "a-accepted", status: "accepted" },
      { ...row, id: "hidden-draft", status: "draft", itemsJson: "bad json" },
      { ...row, id: "hidden-rejected", status: "rejected" }, { ...row, id: "other-quote", demandId: "other-demand" },
      { ...row, id: "special-quote", demandId: specialId },
    ] });
    const result = await read();
    assert.ok(result);
    assert.deepEqual(result.response.data.map((value) => value.id), ["a-accepted", "z-submitted"]);
    assert.deepEqual(result.response.data.map((value) => value.knownTotalCents), [100, 100]);
    assert.equal((await db.quote.findUniqueOrThrow({ where: { id: "z-submitted" } })).knownTotalCents, 999);
    assert.deepEqual((await read(specialId))?.response.data.map((value) => value.id), ["special-quote"]);
    await assert.rejects(read("other-demand"), QuoteReadDenied);
    await clear();
  });

  await t.test("授权后的不存在需求与已有空列表不同，演示数据库结果仍为 mock", async () => {
    // 允许不存在 ID 的测试回调仅验证 null 分支；公开 403/404 顺序仍待 D 冻结。
    assert.equal(await read("absent", async () => true), null);
    const empty = await read("empty-demand");
    assert.deepEqual(empty?.response, { ok: true, data: [], meta: { source: "live" } });
    await db.quote.create({ data: { ...row, id: "demo-row", demandId: "demo-demand" } });
    assert.equal((await read("demo-demand"))?.response.meta.source, "mock");
    await clear();
    assert.equal((await read("demo-demand"))?.response.meta.source, "mock");
    assert.equal((await read("demo-demand"))?.response.data.length, 0);
  });

  await t.test("授权拒绝、异常和非 true 值均先于业务读取；错误 ID 不进入授权", async () => {
    let reads = 0;
    const observed = db.$extends({ query: {
      demandOrder: { async findUnique({ args, query }) { reads++; return query(args); } },
      quote: { async findMany({ args, query }) { reads++; return query(args); } },
    } });
    for (const value of [false, undefined, null, "true", { ok: true }]) {
      await assert.rejects(readStoredQuoteComparison(request, demand.id, (async () => value) as QuoteReadAuthorization, observed as unknown as Pick<PrismaClient, "$transaction">), QuoteReadDenied);
    }
    await assert.rejects(readStoredQuoteComparison(request, demand.id, async () => { throw new Error("authorization failed"); }, observed as unknown as Pick<PrismaClient, "$transaction">), /authorization failed/);
    assert.equal(reads, 0);
    let authorized = false;
    for (const id of ["", " "]) await assert.rejects(read(id, async () => { authorized = true; return true; }), ZodError);
    assert.equal(authorized, false);
  });

  await t.test("重新读取复核当前账户和需求归属，授权与业务读取共享事务视图", async () => {
    assert.ok(await read());
    await db.user.update({ where: { id: "read-owner" }, data: { role: "provider" } });
    await assert.rejects(read(), QuoteReadDenied);
    await db.user.update({ where: { id: "read-owner" }, data: { role: "owner" } });
    await db.demandOrder.update({ where: { id: demand.id }, data: { ownerId: "other-owner" } });
    await assert.rejects(read(), QuoteReadDenied);
    await db.demandOrder.update({ where: { id: demand.id }, data: { ownerId: "read-owner" } });
    const result = await read(demand.id, async (req, id, tx) => {
      await tx.demandOrder.update({ where: { id }, data: { description: "Updated in current transaction" } });
      return ownerAuthorization(req, id, tx);
    });
    assert.equal(result?.demand.description, "Updated in current transaction");
  });

  await t.test("JSON、契约和累计溢出错误使整批失败，不遗漏坏行或返回部分成功", async () => {
    for (const corrupt of [
      { itemsJson: "{" }, { pendingItemsJson: "{" }, { pendingItemsJson: "{}" },
      { itemsJson: JSON.stringify([{ ...item, amountCents: -1 }]) },
      { itemsJson: JSON.stringify([{ ...item, amountCents: Number.MAX_SAFE_INTEGER }, { ...item, code: "extra", amountCents: 1 }]) },
    ]) {
      await db.quote.createMany({ data: [{ ...row, id: "valid-row" }, { ...row, id: "invalid-row", ...corrupt }] });
      await assert.rejects(read());
      await clear();
    }
  });

  await t.test("错位需求、越界报价或数据库异常不能成为空列表或演示回退", async () => {
    await db.quote.create({ data: { ...row, id: "valid-row" } });
    for (const change of [{ demandId: "other-demand" }, { status: "draft" }]) {
      const faulty = db.$extends({ query: { quote: { async findMany({ args, query }) { return (await query(args)).map((value) => ({ ...value, ...change })); } } } });
      await assert.rejects(readStoredQuoteComparison(request, demand.id, async () => true, faulty as unknown as Pick<PrismaClient, "$transaction">), /超出/);
    }
    const wrongDemand = db.$extends({ query: { demandOrder: { async findUnique({ args, query }) {
      const value = await query(args); return value && { ...value, id: "other-demand" };
    } } } });
    await assert.rejects(readStoredQuoteComparison(request, demand.id, async () => true, wrongDemand as unknown as Pick<PrismaClient, "$transaction">), /其他 ID/);
    const unavailable = db.$extends({ query: { quote: { async findMany() { throw new Error("database unavailable"); } } } });
    await assert.rejects(readStoredQuoteComparison(request, demand.id, ownerAuthorization, unavailable as unknown as Pick<PrismaClient, "$transaction">), /database unavailable/);
    await clear();
  });

  await t.test("公开 GET 无参数仍使用已开放的 mock 契约", async () => {
    const response = await GET(new Request("http://localhost/api/quote"));
    assert.equal(response.status, 200);
    const body = envelope(Quote.array()).parse(await response.json());
    assert.equal(body.meta.source, "mock");
    assert.ok(body.data.every((value) => value.demandId === "demo-demand"));
  });
});
