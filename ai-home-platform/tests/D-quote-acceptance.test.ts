import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, OrderAcceptInput, OrderSummary, envelope } from "../src/contracts";
import { handleOrderAccept, handleProviderOrders } from "../src/lib/order";
import { createOwnerAccount } from "../src/lib/owner-account";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";
import { DEMO_SESSION_COOKIE, issueDemoSession, revokeDemoSession } from "../src/lib/demo-provider-session";

const origin = "https://localhost:3000";
const password = "Synthetic-quote-acceptance-password-42";
const input = { demandId: "one", quoteId: "q-one", confirmed: true };
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body: unknown = input) => new Request(`${origin}/api/order`, {
  method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
});
const readRequest = (cookie = "", query = "") => new Request(`${origin}/api/provider/orders${query}`, { headers: { cookie } });
function noCache(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  noCache(response); assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal("data" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|itemsJson/);
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}

test("接受报价契约：明确确认、精确 ID、拒绝自报身份与状态；接单来源必填", () => {
  assert.equal(OrderAcceptInput.parse({ ...input, demandId: " one " }).demandId, " one ");
  for (const field of ["demandId", "quoteId"]) for (const value of ["", " ", null, undefined, 1]) {
    assert.equal(OrderAcceptInput.safeParse({ ...input, [field]: value }).success, false);
  }
  for (const confirmed of [false, "true", 1, undefined, null]) assert.equal(OrderAcceptInput.safeParse({ ...input, confirmed }).success, false);
  for (const extra of [{ ownerId: "owner" }, { providerId: "provider-a" }, { source: "live" }, { status: "accepted" }, { amountCents: 0 }, { meta: { source: "live" } }]) {
    assert.equal(OrderAcceptInput.safeParse({ ...input, ...extra }).success, false);
  }
  const summary = { id: "order", demandId: "one", providerId: "provider-a", acceptedQuoteId: "q-one", status: "contracted", source: "mock" };
  assert.ok(OrderSummary.safeParse(summary).success);
  for (const extra of [{ source: undefined }, { source: "unknown" }, { status: "accepted" }, { amountCents: 0 }]) {
    assert.equal(OrderSummary.safeParse({ ...summary, ...extra }).success, false);
  }
});

test("接受报价与接单：隔离 SQLite、当前授权、原子性、并发及公开接口", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-quote-acceptance-"));
  const databasePath = join(fixture, "orders.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const originalDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (originalDemo === undefined) delete process.env.DEMO_AUTH_ENABLED; else process.env.DEMO_AUTH_ENABLED = originalDemo;
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-quote-acceptance-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const owner = await createOwnerAccount({ login: "acceptance-one", name: "Synthetic first", password }, db);
  const other = await createOwnerAccount({ login: "acceptance-two", name: "Synthetic second", password }, db);
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: owner.userId, role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: other.userId, role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  await db.serviceProvider.createMany({ data: [DEMO_PROVIDER_ID, "provider-b"].map(id => ({ id, name: id, city: "Test", kind: "construction", tagsJson: "[]" })) });
  await db.user.create({ data: { id: DEMO_PROVIDER_USER_ID, name: "Synthetic demo", role: "provider", providerId: DEMO_PROVIDER_ID } });
  const demands = ["one", "two", "alt", "legacy", "demo-demand", " one "].map(id => ({ id, ownerId: id === "two" ? other.userId : owner.userId,
    description: "Synthetic demand", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000,
    renovationType: "repair", desiredDays: 10, status: "published" }));
  const items = [
    { code: "known", name: "已知", unit: "job", quantity: 1, unitPriceCents: 100, amountCents: 100, note: "合成测试" },
    { code: "pending", name: "待定", unit: "job", quantity: 1, unitPriceCents: null, amountCents: null, note: "不可当作零" },
  ];
  const quotes = [
    ["q-one", "one", DEMO_PROVIDER_ID, "mock"], ["q-other", "one", "provider-b", "live"],
    ["q-two", "two", "provider-b", "live"], ["q-alt", "alt", DEMO_PROVIDER_ID, "live"],
    ["q-legacy", "legacy", DEMO_PROVIDER_ID, "mock"], ["q-demo", "demo-demand", DEMO_PROVIDER_ID, "mock"],
    ["q-space", " one ", DEMO_PROVIDER_ID, "mock"],
  ].map(([id, demandId, providerId, source]) => ({ id, demandId, providerId, source, status: id === "q-legacy" ? "accepted" : "submitted",
    itemsJson: JSON.stringify(items), pendingItemsJson: '["待定费用"]', knownTotalCents: 100, estimatedDays: 5 }));
  let providerCookie: string;
  t.beforeEach(async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { userId: owner.userId, revokedAt: null, expiresAt: issued.expiresAt } });
    await db.serviceOrder.deleteMany(); await db.quoteSubmissionReceipt.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: demands }); await db.quote.createMany({ data: quotes });
    await db.quoteSubmissionReceipt.create({ data: { id: "receipt", providerId: DEMO_PROVIDER_ID, idempotencyKey: "synthetic-receipt-key", requestHash: "synthetic", quoteId: "q-one" } });
    providerCookie = `${DEMO_SESSION_COOKIE}=${(await issueDemoSession(request(), db)).token}`;
  });
  const accept = (body: unknown = input, credential = cookie, client: Database = db) => handleOrderAccept(request(credential, body), client);
  const read = (credential = providerCookie, client: Database = db) => handleProviderOrders(readRequest(credential), client);
  const snapshot = async () => ({
    demands: await db.demandOrder.findMany({ orderBy: { id: "asc" } }), quotes: await db.quote.findMany({ orderBy: { id: "asc" } }),
    orders: await db.serviceOrder.findMany({ orderBy: { id: "asc" } }), receipts: await db.quoteSubmissionReceipt.findMany({ orderBy: { id: "asc" } }),
  });

  await t.test("首次原子接受，重放返回原关系，保留其他报价/提交回执/null 费用与 mock", async () => {
    const before = await snapshot();
    const response = await accept(); noCache(response); assert.equal(response.status, 201);
    const body = envelope(OrderSummary).parse(await response.json());
    assert.equal(body.meta.source, "mock"); assert.equal(body.data.source, "mock");
    assert.equal(body.data.demandId, "one"); assert.equal(body.data.providerId, DEMO_PROVIDER_ID); assert.equal(body.data.status, "contracted");
    const after = await snapshot();
    assert.equal(after.orders.length, 1); assert.equal(after.demands.find(d => d.id === "one")!.status, "contracted");
    assert.deepEqual(after.quotes, before.quotes.map(q => q.id === "q-one" ? { ...q, status: "accepted" } : q));
    assert.deepEqual(after.receipts, before.receipts);
    const replay = await accept(); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), body);
    assert.deepEqual(await snapshot(), after);
    await denied(await accept({ ...input, quoteId: "q-other" }), 409, "ORDER_ALREADY_EXISTS");
    assert.deepEqual(await snapshot(), after);
    const listing = envelope(OrderSummary.array()).parse(await (await read()).json());
    assert.deepEqual(listing.data, [body.data]); assert.equal(listing.meta.source, "mock");
    for (const status of ["in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } });
      await db.serviceOrder.update({ where: { demandId: "one" }, data: { status } });
      const response = await accept(); assert.equal(response.status, 200); assert.equal((await response.json()).data.status, status);
    }
  });

  await t.test("只查本人实际接单，混合逐条来源保留，旧 accepted 不补单，空列表不造假", async () => {
    assert.deepEqual(await (await read()).json(), { ok: true, data: [], meta: { source: "mock" } });
    const a = await accept(); const first = (await a.json()).data;
    const b = await accept({ demandId: "two", quoteId: "q-two", confirmed: true }, otherCookie); assert.equal(b.status, 201);
    const c = await accept({ demandId: "alt", quoteId: "q-alt", confirmed: true }); assert.equal(c.status, 201);
    const live = await c.json(); assert.equal(live.meta.source, "live"); assert.equal(live.data.source, "live");
    const req = readRequest(`${cookie}; ${providerCookie}`); req.headers.set("x-provider-id", "provider-b"); req.headers.set("x-role", "admin");
    const response = await handleProviderOrders(req, db); noCache(response); assert.equal(response.status, 200);
    const result = envelope(OrderSummary.array()).parse(await response.json());
    assert.equal(result.meta.source, "mock"); assert.deepEqual(result.data.map(o => o.id), [first.id, live.data.id].sort());
    assert.ok(result.data.every(o => o.providerId === DEMO_PROVIDER_ID)); assert.equal(await db.serviceOrder.count(), 3);
    assert.equal(await db.serviceOrder.count({ where: { demandId: "legacy" } }), 0);
  });

  await t.test("写入方法/同源/参数先行拒绝；未授权不消费正文或读取业务记录", async () => {
    let calls = 0;
    const broken = { $transaction: async () => { calls++; throw new Error("private database"); } } as unknown as Database;
    const invalidHeaders: HeadersInit[] = [{}, { origin: "https://foreign.invalid" }, { origin, "sec-fetch-site": "cross-site" }];
    for (const headers of invalidHeaders) {
      await denied(await handleOrderAccept(new Request(`${origin}/api/order`, { method: "POST", headers }), broken), 403, "FORBIDDEN");
    }
    await denied(await handleOrderAccept(new Request(`${origin}/api/order`, { headers: { origin } }), broken), 403, "FORBIDDEN");
    await denied(await handleOrderAccept(new Request(`${origin}/api/order?providerId=provider-b`, { method: "POST", headers: { origin } }), broken), 400, "VALIDATION_ERROR");
    assert.equal(calls, 0);
    const req = request("", { invalid: true });
    await denied(await handleOrderAccept(req, db), 401, "UNAUTHENTICATED"); assert.equal(req.bodyUsed, false);
    assert.equal(await db.serviceOrder.count(), 0);
  });

  await t.test("失效/重复/过期/撤销/仅服务方凭证 401，当前角色变化 403", async () => {
    const before = await snapshot();
    for (const value of ["", `${OWNER_SESSION_COOKIE}=invalid`, `${cookie}; ${cookie}`, providerCookie]) await denied(await accept(input, value), 401, "UNAUTHENTICATED");
    for (const data of [{ expiresAt: new Date(0) }, { revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data }); await denied(await accept(), 401, "UNAUTHENTICATED");
      await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: issued.expiresAt, revokedAt: null } });
    }
    await db.user.update({ where: { id: owner.userId }, data: { role: "admin" } }); await denied(await accept(), 403, "FORBIDDEN");
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("事务内重验身份/当前角色/归属，预检快照不能授权写入，重放也重验", async () => {
    const changes: [(tx: Prisma.TransactionClient) => Promise<unknown>, number, string][] = [
      [tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } }), 401, "UNAUTHENTICATED"],
      [tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(0) } }), 401, "UNAUTHENTICATED"],
      [tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { userId: other.userId } }), 403, "FORBIDDEN"],
      [tx => tx.user.update({ where: { id: owner.userId }, data: { role: "provider" } }), 403, "FORBIDDEN"],
      [tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } }), 404, "DEMAND_NOT_FOUND"],
    ];
    for (const replay of [false, true]) {
      if (replay) assert.equal((await accept()).status, 201);
      for (const [change, status, code] of changes) {
        const before = await snapshot(); let transactions = 0;
        const client = decorate(db, async tx => { if (++transactions === 2) await change(tx); return tx; });
        await denied(await accept(input, cookie, client), status, code); assert.deepEqual(await snapshot(), before);
      }
    }
  });

  await t.test("坏 JSON/超限/控制字段拒绝；无越权枚举；演示需求只读；ID 精确匹配", async () => {
    const before = await snapshot();
    for (const raw of ["{", "", " ".repeat(4097)]) {
      await denied(await handleOrderAccept(new Request(`${origin}/api/order`, { method: "POST", headers: { origin, cookie }, body: raw }), db),
        400, raw.length > 4096 ? "VALIDATION_ERROR" : "INVALID_JSON");
    }
    for (const fields of [{ providerId: DEMO_PROVIDER_ID }, { ownerId: owner.userId }, { source: "live" }, { confirmed: false }, { quoteId: " " }]) {
      await denied(await accept({ ...input, ...fields }), 400, "VALIDATION_ERROR");
    }
    for (const demandId of ["two", "missing"]) await denied(await accept({ ...input, demandId }), 404, "DEMAND_NOT_FOUND");
    for (const quoteId of ["q-two", "missing", " q-one "]) await denied(await accept({ ...input, quoteId }), 404, "QUOTE_NOT_FOUND");
    await denied(await accept(input, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await accept({ demandId: "demo-demand", quoteId: "q-demo", confirmed: true }), 409, "DEMO_DEMAND_READ_ONLY");
    assert.deepEqual(await snapshot(), before);
    const response = await accept({ demandId: " one ", quoteId: "q-space", confirmed: true }); assert.equal(response.status, 201);
    assert.equal((await response.json()).data.demandId, " one ");
  });

  await t.test("首次只允许 published/submitted，旧 accepted 无关系必须人工核实", async () => {
    for (const status of ["draft", "contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } }); const before = await snapshot();
      await denied(await accept(), 409, "INVALID_STATE"); assert.deepEqual(await snapshot(), before);
    }
    await db.demandOrder.update({ where: { id: "one" }, data: { status: "published" } });
    for (const status of ["draft", "rejected", "accepted"]) {
      await db.quote.update({ where: { id: "q-one" }, data: { status } }); const before = await snapshot();
      await denied(await accept(), 409, status === "accepted" ? "ACCEPTED_QUOTE_CONFLICT" : "INVALID_STATE"); assert.deepEqual(await snapshot(), before);
    }
    await denied(await accept({ demandId: "legacy", quoteId: "q-legacy", confirmed: true }), 409, "ACCEPTED_QUOTE_CONFLICT");
    await db.quote.update({ where: { id: "q-one" }, data: { status: "submitted" } });
    await db.quote.update({ where: { id: "q-other" }, data: { status: "accepted" } });
    await denied(await accept(), 409, "ACCEPTED_QUOTE_CONFLICT"); assert.equal(await db.serviceOrder.count(), 0);
  });

  await t.test("坏报价来源/JSON/字段失败，不把坏库当作 mock 或保存成功", async () => {
    const original = quotes.find(q => q.id === "q-one")!;
    for (const data of [{ source: "unknown" }, { itemsJson: "{" }, { pendingItemsJson: "{}" }, { knownTotalCents: -1 }, { status: "bad" }]) {
      await db.quote.update({ where: { id: "q-one" }, data }); const before = await snapshot();
      await denied(await accept(), 503, "ORDER_UNAVAILABLE"); assert.deepEqual(await snapshot(), before);
      await db.quote.update({ where: { id: "q-one" }, data: original });
    }
  });

  await t.test("最终写入核对归属/状态/原报价快照，并在条件不再匹配时完整回滚", async () => {
    const before = await snapshot();
    for (const change of [
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } }),
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { status: "completed" } }),
      (tx: Prisma.TransactionClient) => tx.quote.update({ where: { id: "q-one" }, data: { knownTotalCents: 999 } }),
      (tx: Prisma.TransactionClient) => tx.quote.update({ where: { id: "q-one" }, data: { source: "live" } }),
      (tx: Prisma.TransactionClient) => tx.quote.update({ where: { id: "q-other" }, data: { status: "accepted" } }),
    ]) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        updateMany: async (args: Prisma.DemandOrderUpdateManyArgs) => { await change(tx); return tx.demandOrder.updateMany(args); },
      } }) as unknown as Prisma.TransactionClient);
      await denied(await accept(input, cookie, client), 409, "INVALID_STATE"); assert.deepEqual(await snapshot(), before);
    }
    const client = decorate(db, async tx => ({ ...tx, quote: { ...tx.quote,
      updateMany: async (args: Prisma.QuoteUpdateManyArgs) => {
        await tx.quote.update({ where: { id: "q-one" }, data: { estimatedDays: 9 } }); return tx.quote.updateMany(args);
      },
    } }) as unknown as Prisma.TransactionClient);
    await denied(await accept(input, cookie, client), 409, "INVALID_STATE"); assert.deepEqual(await snapshot(), before);
  });

  await t.test("创建/提交故障、坏输出和越界结果回滚需求与报价，错误不泄露内部信息", async () => {
    const before = await snapshot();
    const broken = decorate(db, async tx => ({ ...tx, serviceOrder: { ...tx.serviceOrder,
      create: async () => { throw new Error("private database tokenHash"); },
    } }) as unknown as Prisma.TransactionClient);
    await denied(await accept(input, cookie, broken), 503, "ORDER_UNAVAILABLE"); assert.deepEqual(await snapshot(), before);
    for (const change of [{ id: "wrong" }, { status: "completed" }, { providerId: "provider-b" }, { acceptedQuoteId: "q-other" }, { source: "bad" }]) {
      const client = decorate(db, async tx => ({ ...tx, serviceOrder: { ...tx.serviceOrder,
        findUniqueOrThrow: async (args: Prisma.ServiceOrderFindUniqueOrThrowArgs) => ({ ...await tx.serviceOrder.findUniqueOrThrow(args), ...change }),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await accept(input, cookie, client), 503, "ORDER_UNAVAILABLE"); assert.deepEqual(await snapshot(), before);
    }
    let calls = 0;
    const failedCommit = { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) =>
      db.$transaction(async tx => { const value = await run(tx); if (++calls === 2) throw new Error("private database commit"); return value; }, options) } as unknown as Database;
    await denied(await accept(input, cookie, failedCommit), 503, "ORDER_UNAVAILABLE"); assert.deepEqual(await snapshot(), before);
  });

  await t.test("两连接重复接受仅一条关系；两份竞争报价最多一个赢家，重试可确定结果", async () => {
    let responses = await Promise.all([accept(), accept(input, cookie, second)]);
    assert.equal(responses.filter(r => r.status === 201).length, 1); assert.ok(responses.every(r => [200, 201, 409, 503].includes(r.status)));
    assert.equal(await db.serviceOrder.count(), 1); assert.equal((await accept()).status, 200);
    const left = { demandId: "alt", quoteId: "q-alt", confirmed: true };
    await db.quote.create({ data: { ...quotes[1], id: "q-competitor", demandId: "alt" } });
    const right = { ...left, quoteId: "q-competitor" };
    responses = await Promise.all([accept(left), accept(right, cookie, second)]);
    assert.equal(responses.filter(r => r.status === 201).length, 1); assert.ok(responses.every(r => [201, 409, 503].includes(r.status)));
    const saved = await db.serviceOrder.findUniqueOrThrow({ where: { demandId: "alt" } });
    assert.equal(await db.quote.count({ where: { demandId: "alt", status: "accepted" } }), 1);
    assert.equal((await accept({ ...left, quoteId: saved.acceptedQuoteId })).status, 200);
    await denied(await accept(saved.acceptedQuoteId === left.quoteId ? right : left), 409, "ORDER_ALREADY_EXISTS");
    await assert.rejects(db.serviceOrder.create({ data: { ...saved, id: "duplicate" } }));
  });

  await t.test("服务方查询拒绝参数/伪造身份，实时核验关闭/失效/撤销/绑定，只有业主 403", async () => {
    let calls = 0; const broken = { $transaction: async () => { calls++; throw new Error("private database"); } } as unknown as Database;
    for (const query of ["?providerId=provider-b", "?userId=owner", "?status=contracted", "?demandId=one", "?page=1", "?providerId=a&providerId=b"]) {
      await denied(await handleProviderOrders(readRequest(providerCookie, query), broken), 400, "VALIDATION_ERROR");
    }
    assert.equal(calls, 0);
    for (const credential of ["", `${DEMO_SESSION_COOKIE}=forged`, `${providerCookie}; ${providerCookie}`]) await denied(await read(credential), 401, "UNAUTHENTICATED");
    await denied(await read(cookie), 403, "FORBIDDEN");
    for (const data of [{ role: "owner" }, { providerId: "provider-b" }, { providerId: null }]) {
      const client = decorate(db, async tx => { await tx.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data }); return tx; });
      await denied(await read(providerCookie, client), 401, "UNAUTHENTICATED");
    }
    process.env.DEMO_AUTH_ENABLED = "false"; await denied(await read(), 401, "UNAUTHENTICATED"); process.env.DEMO_AUTH_ENABLED = "true";
    const expired = await issueDemoSession(request(), db, new Date(0)); await denied(await read(`${DEMO_SESSION_COOKIE}=${expired.token}`), 401, "UNAUTHENTICATED");
    await revokeDemoSession(readRequest(providerCookie), db); await denied(await read(), 401, "UNAUTHENTICATED");
  });

  await t.test("不一致/坏来源/非法状态、越界/重复行及数据库故障不回退成功空列表", async () => {
    assert.equal((await accept()).status, 201);
    const order = await db.serviceOrder.findUniqueOrThrow({ where: { demandId: "one" } });
    for (const data of [{ providerId: "provider-b" }, { acceptedQuoteId: "q-other" }, { source: "live" }, { source: "bad" }, { status: "completed" }]) {
      await db.serviceOrder.update({ where: { id: order.id }, data });
      await denied(await accept(), 503, "ORDER_UNAVAILABLE");
      // A different provider is filtered out, not leaked. Other corruption must fail the current provider list.
      if (!("providerId" in data)) await denied(await read(), 503, "ORDER_UNAVAILABLE");
      await db.serviceOrder.update({ where: { id: order.id }, data: order });
    }
    for (const data of [{ status: "submitted" }, { source: "live" }, { itemsJson: "{" }]) {
      await db.quote.update({ where: { id: "q-one" }, data });
      await denied(await read(), 503, "ORDER_UNAVAILABLE"); await denied(await accept(), 503, "ORDER_UNAVAILABLE");
      await db.quote.update({ where: { id: "q-one" }, data: { ...quotes[0], status: "accepted" } });
    }
    for (const transform of [
      (rows: unknown[]) => [...rows, rows[0]],
      (rows: unknown[]) => rows.map(row => ({ ...row as object, providerId: "provider-b" })),
    ]) {
      const client = decorate(db, async tx => ({ ...tx, serviceOrder: { ...tx.serviceOrder,
        findMany: async (args: Prisma.ServiceOrderFindManyArgs) => transform(await tx.serviceOrder.findMany(args)),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await read(providerCookie, client), 503, "ORDER_UNAVAILABLE");
    }
    const broken = { $transaction: async () => { throw new Error("private database tokenHash"); } } as unknown as Database;
    await denied(await read(providerCookie, broken), 503, "ORDER_UNAVAILABLE"); await denied(await accept(input, cookie, broken), 503, "ORDER_UNAVAILABLE");
  });

  await t.test("公开路由登录/提交报价/业主接受/本人接单/重放，签约后提交回执仍拒绝，退出后拒绝", () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    const script = join(fixture, "public-acceptance.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { POST as ownerLogin, DELETE as ownerLogout } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { POST as providerLogin, DELETE as providerLogout } from ${modulePath("src/app/api/auth/demo-provider/route.ts")};
      import { POST as createDemand } from ${modulePath("src/app/api/demand/route.ts")};
      import { POST as submit, GET as quotes } from ${modulePath("src/app/api/quote/route.ts")};
      import { POST as accept } from ${modulePath("src/app/api/order/route.ts")};
      import { GET as orders } from ${modulePath("src/app/api/provider/orders/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (path, method = 'GET', cookie = '', body, extra = {}) => new Request('${origin}' + path, { method,
        headers: { origin: '${origin}', cookie, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        const login = await ownerLogin(req('/api/auth/owner', 'POST', '', { login: 'acceptance-one', password: ${JSON.stringify(password)} }));
        assert.equal(login.status, 200); const owner = login.headers.get('set-cookie').split(';')[0];
        const created = await createDemand(req('/api/demand', 'POST', owner, { description: 'Synthetic', city: 'Test', areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000, renovationType: 'repair', desiredDays: 10 }));
        assert.equal(created.status, 201); const demandId = (await created.json()).data.id;
        const session = await providerLogin(req('/api/auth/demo-provider', 'POST', '', { action: 'login_demo' }));
        assert.equal(session.status, 200); const provider = session.headers.get('set-cookie').split(';')[0];
        const submission = { demandId, estimatedDays: 5, items: [{ code: 'pending', name: '待确认', quantity: 1, unit: 'job', unitPriceCents: null, note: '合成测试' }] };
        const extra = { 'Idempotency-Key': 'public-acceptance-key-1234' };
        const quote = await submit(req('/api/quote', 'POST', provider, submission, extra));
        assert.equal(quote.status, 201); const quoteId = (await quote.json()).data.id;
        const input = { demandId, quoteId, confirmed: true };
        const accepted = await accept(req('/api/order', 'POST', owner, input)); assert.equal(accepted.status, 201);
        const saved = await accepted.json(); assert.equal(saved.meta.source, 'mock'); assert.equal(saved.data.acceptedQuoteId, quoteId);
        const read = await orders(req('/api/provider/orders', 'GET', provider)); assert.equal(read.status, 200);
        assert.deepEqual((await read.json()).data, [saved.data]);
        const replay = await accept(req('/api/order', 'POST', owner, input)); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), saved);
        const comparison = await quotes(req('/api/quote?demandId=' + demandId, 'GET', owner)); assert.equal(comparison.status, 200);
        const quoteData = (await comparison.json()).data; assert.equal(quoteData[0].status, 'accepted'); assert.equal(quoteData[0].items[0].amountCents, null);
        assert.equal((await submit(req('/api/quote', 'POST', provider, submission, extra))).status, 409);
        assert.equal((await ownerLogout(req('/api/auth/owner', 'DELETE', owner))).status, 200);
        assert.equal((await accept(req('/api/order', 'POST', owner, input))).status, 401);
        assert.equal((await providerLogout(req('/api/auth/demo-provider', 'DELETE', provider))).status, 200);
        assert.equal((await orders(req('/api/provider/orders', 'GET', provider))).status, 401);
        assert.equal(await prisma.serviceOrder.count(), 1);
        console.log('public-quote-acceptance-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DEMO_AUTH_ENABLED: "true" }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-quote-acceptance-ok/);
  });
});
