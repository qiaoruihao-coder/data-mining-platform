import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { OrderQuery, OwnerOrderResult, envelope } from "../src/contracts";
import { handleOwnerOrderRead } from "../src/lib/order";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";
import { GET } from "../src/app/api/order/route";

const origin = "https://localhost:3000";
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", query = "?demandId=one", method = "GET") => new Request(`${origin}/api/order${query}`, { method, headers: { cookie } });
async function checked(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), /ownerId|tokenHash|itemsJson|private database/);
  if (status === 200) return envelope(OwnerOrderResult).parse(body);
  assert.equal(body.ok, false); assert.equal(body.error.code, code);
  assert.equal("data" in body, false); assert.equal("meta" in body, false); return body;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}

test("业主接单契约允许明确 null、精确 ID，路由拒绝匿名", async () => {
  assert.equal(OrderQuery.parse({ demandId: " one " }).demandId, " one ");
  for (const value of [{}, { demandId: " " }, { demandId: "one", providerId: "provider" }]) assert.equal(OrderQuery.safeParse(value).success, false);
  assert.equal(OwnerOrderResult.parse(null), null);
  assert.equal(OwnerOrderResult.safeParse([]).success, false);
  await checked(await GET(request()), 401, "UNAUTHENTICATED");
});

test("业主接单读取：隔离 SQLite 验证归属、状态、来源、空态与只读", async t => {
  const tempRoot = resolve(tmpdir()); const fixture = mkdtempSync(join(tempRoot, "ai-home-D-owner-order-"));
  const path = join(fixture, "orders.db"); const url = `file:${path.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await db.$disconnect(); assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-owner-order-")); rmSync(fixture, { recursive: true, force: true }); });
  writeFileSync(path, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 30000,
  });
  await db.user.createMany({ data: ["owner", "other"].map(id => ({ id, name: "Synthetic owner", role: "owner" })) });
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: "owner", role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const tokenHash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: "other", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  await db.serviceProvider.createMany({ data: ["p-one", "p-two"].map(id => ({ id, name: "Synthetic", city: "Test", kind: "construction", tagsJson: "[]", rating: 3 })) });
  t.beforeEach(async () => {
    await db.user.update({ where: { id: "owner" }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash }, data: { revokedAt: null, expiresAt: issued.expiresAt } });
    await db.serviceOrder.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: ["one", "two", "empty", "demo-demand", " one "].map(id => ({ id,
      ownerId: id === "two" ? "other" : "owner", description: "Synthetic demand", city: "Test", areaM2: 20,
      budgetMinCents: 0, budgetMaxCents: 1000, renovationType: "repair", desiredDays: 5,
      status: ["one", "two"].includes(id) ? "contracted" : "published" })) });
    await db.quote.createMany({ data: ["one", "two"].map(id => ({ id: `q-${id}`, demandId: id, providerId: `p-${id}`, source: "mock", status: "accepted",
      itemsJson: "[]", pendingItemsJson: "[]", knownTotalCents: 0, estimatedDays: 5 })) });
    await db.serviceOrder.createMany({ data: ["one", "two"].map(id => ({ id: `o-${id}`, demandId: id, providerId: `p-${id}`,
      acceptedQuoteId: `q-${id}`, source: "mock", status: "contracted" })) });
  });
  const read = (id = "one", credential = cookie, client: Database = db) => handleOwnerOrderRead(request(credential, `?demandId=${encodeURIComponent(id)}`), client);
  const snapshot = async () => ({ demands: await db.demandOrder.findMany(), quotes: await db.quote.findMany(), orders: await db.serviceOrder.findMany() });

  await t.test("本人三种履约状态和来源完整返回，每次读取不写任何业务数据", async () => {
    for (const source of ["mock", "live"]) for (const status of ["contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } });
      await db.serviceOrder.update({ where: { id: "o-one" }, data: { status, source } });
      await db.quote.update({ where: { id: "q-one" }, data: { source } });
      const before = await snapshot();
      const result = await checked(await read(), 200);
      assert.deepEqual(result, { ok: true, data: { id: "o-one", demandId: "one", providerId: "p-one", acceptedQuoteId: "q-one", status, source }, meta: { source } });
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test("无接单返回 null，旧 accepted 报价不造单，空态来源与精确 ID", async () => {
    for (const status of ["draft", "published"]) {
      await db.demandOrder.update({ where: { id: "empty" }, data: { status } });
      assert.deepEqual(await checked(await read("empty"), 200), { ok: true, data: null, meta: { source: "live" } });
    }
    await db.quote.create({ data: { id: "legacy", demandId: "empty", providerId: "p-one", status: "accepted", source: "mock", itemsJson: "[]", pendingItemsJson: "[]", knownTotalCents: 0, estimatedDays: 1 } });
    assert.equal((await checked(await read("empty"), 200)).data, null);
    assert.equal((await checked(await read(" one "), 200)).data, null);
    assert.deepEqual(await checked(await read("demo-demand"), 200), { ok: true, data: null, meta: { source: "mock" } });
    assert.equal(await db.serviceOrder.count(), 2);
  });
  await t.test("跨业主与不存在统一 404，公开需求与演示均无公开接单入口", async () => {
    const missing = await checked(await read("missing"), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(await checked(await read("two"), 404, "DEMAND_NOT_FOUND"), missing);
    assert.deepEqual(await checked(await read("empty", otherCookie), 404, "DEMAND_NOT_FOUND"), missing);
    assert.deepEqual(await checked(await read("demo-demand", otherCookie), 404, "DEMAND_NOT_FOUND"), missing);
    assert.equal((await checked(await read("two", otherCookie), 200)).data.id, "o-two");
    await checked(await read("demo-demand", ""), 401, "UNAUTHENTICATED");
  });
  await t.test("缺失/重复/未知/空白参数在查询数据库前拒绝", async () => {
    const never = { $transaction: async () => { assert.fail("invalid input must not query storage"); } } as unknown as Database;
    for (const query of ["", "?demandId=", "?demandId=%20", "?demandId=one&demandId=one", "?demandId=one&ownerId=owner", "?providerId=p-one"]) {
      await checked(await handleOwnerOrderRead(request(cookie, query), never), 400, "VALIDATION_ERROR");
    }
    await checked(await handleOwnerOrderRead(request(cookie, "?demandId=one", "POST"), never), 403, "FORBIDDEN");
    await checked(await handleOwnerOrderRead(request(cookie, "?demandId=one", "HEAD"), db), 200);
  });
  await t.test("匿名/坏/重复/过期/撤销凭证和角色变化拒绝，双 cookie 不能扩大范围", async () => {
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, "ai_home_demo_session=forged"]) await checked(await read("one", credential), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { expiresAt: new Date(0) } });
    await checked(await read(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { expiresAt: issued.expiresAt, revokedAt: new Date() } });
    await checked(await read(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { revokedAt: null } });
    await checked(await read("one", `${cookie}; ai_home_demo_session=forged`), 200);
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: "owner" }, data: { role } }); await checked(await read(), 403, "FORBIDDEN");
    }
  });
  await t.test("同一读取事务重验撤销、角色和归属，无预检快照授权", async () => {
    for (const [change, status, code] of [
      [async (tx: Prisma.TransactionClient) => { await tx.ownerSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } }); }, 401, "UNAUTHENTICATED"],
      [async (tx: Prisma.TransactionClient) => { await tx.user.update({ where: { id: "owner" }, data: { role: "provider" } }); }, 403, "FORBIDDEN"],
      [async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "other" } }); }, 404, "DEMAND_NOT_FOUND"],
    ] as const) {
      const client = decorate(db, async tx => { await change(tx); return tx; });
      await checked(await read("one", cookie, client), status, code);
    }
  });
  await t.test("缺接单的后续状态、坏来源与关联均 503，不变成空成功", async () => {
    for (const status of ["contracted", "in_progress", "completed", "broken"]) {
      await db.demandOrder.update({ where: { id: "empty" }, data: { status } }); await checked(await read("empty"), 503, "ORDER_UNAVAILABLE");
    }
    for (const change of [
      async (tx: Prisma.TransactionClient) => { await tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "live" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.serviceOrder.update({ where: { id: "o-one" }, data: { providerId: "p-two" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { status: "completed" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.quote.update({ where: { id: "q-one" }, data: { status: "submitted" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.quote.update({ where: { id: "q-one" }, data: { itemsJson: "broken" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.quote.update({ where: { id: "q-one" }, data: { source: "unknown" } }); },
    ]) await checked(await read("one", cookie, decorate(db, async tx => { await change(tx); return tx; })), 503, "ORDER_UNAVAILABLE");
  });
  await t.test("SQL 按本人需求过滤，意外返回其他接单或数据库故障不泄露", async () => {
    const client = decorate(db, async tx => ({ ...tx, serviceOrder: { ...tx.serviceOrder,
      findFirst: async (args: Prisma.ServiceOrderFindFirstArgs) => {
        assert.deepEqual(args.where, { demandId: "one", demand: { ownerId: "owner" } });
        return tx.serviceOrder.findFirst({ ...args, where: { demandId: "two" } });
      },
    } }) as unknown as Prisma.TransactionClient);
    await checked(await read("one", cookie, client), 503, "ORDER_UNAVAILABLE");
    const broken = { $transaction: async () => { throw new Error("private database"); } } as unknown as Database;
    await checked(await read("one", cookie, broken), 503, "ORDER_UNAVAILABLE");
  });
});
