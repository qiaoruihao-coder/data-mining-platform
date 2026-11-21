import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { OrderProgressEvent, OrderProgressResult, SQLITE_INT_MAX, envelope, type OrderProgressEventDTO } from "../src/contracts";
import { handleOrderProgressHistory } from "../src/lib/order-progress-history";
import { handleOrderProgress } from "../src/lib/order-progress";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";
import { GET } from "../src/app/api/order/progress/route";

const origin = "https://localhost:3000";
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", query = "?demandId=one", method = "GET") => new Request(`${origin}/api/order/progress${query}`, { method, headers: { cookie } });
async function checked(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), /actorId|ownerId|tokenHash|itemsJson|Synthetic owner|private database/);
  if (status === 200) return envelope(OrderProgressEvent.array()).parse(body);
  assert.equal(body.ok, false); assert.equal(body.error.code, code);
  assert.equal("data" in body, false); assert.equal("meta" in body, false); return body;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}

test("履约记录契约校验动作/状态/工序/版本/来源，拒绝内部身份字段", async () => {
  const event = { id: "event", orderId: "order", action: "start", fromStatus: "contracted", toStatus: "in_progress",
    taskId: null, scheduleVersion: null, createdAt: "2026-11-14T10:00:00.000Z", source: "mock" };
  assert.deepEqual(OrderProgressEvent.parse(event), event);
  for (const patch of [
    { action: "complete", fromStatus: "in_progress", toStatus: "completed", scheduleVersion: 3 },
    ...["start_task", "complete_task"].map(action => ({ action, fromStatus: "in_progress", taskId: "first", scheduleVersion: 2 })),
    { createdAt: "2099-01-01T00:00:00+08:00", source: "live" },
  ]) assert.ok(OrderProgressEvent.safeParse({ ...event, ...patch }).success);
  for (const patch of [
    { id: " " }, { orderId: "" }, { action: "cancel" }, { fromStatus: "completed" }, { toStatus: "completed" },
    { taskId: "first" }, { scheduleVersion: 0 }, { scheduleVersion: SQLITE_INT_MAX + 1 }, { source: "unknown" },
    { createdAt: "tomorrow" }, { actorId: "private owner" },
    { action: "start_task", fromStatus: "in_progress", taskId: null, scheduleVersion: 2 },
    { action: "complete_task", fromStatus: "in_progress", taskId: "first", scheduleVersion: 1 },
  ]) assert.equal(OrderProgressEvent.safeParse({ ...event, ...patch }).success, false, JSON.stringify(patch));
  await checked(await GET(request()), 401, "UNAUTHENTICATED");
});

test("履约记录读取：隔离 SQLite 验证实际动作、归属、来源、只读和异常", async t => {
  const tempRoot = resolve(tmpdir()); const fixture = mkdtempSync(join(tempRoot, "ai-home-D-progress-history-"));
  const path = join(fixture, "history.db"); const url = `file:${path.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await db.$disconnect(); assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-progress-history-")); rmSync(fixture, { recursive: true, force: true }); });
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
    await db.orderProgressEvent.deleteMany(); await db.schedule.deleteMany();
    await db.serviceOrder.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: ["one", "two", "empty", "demo-demand", " one "].map(id => ({ id,
      ownerId: id === "two" ? "other" : "owner", description: "Synthetic demand", city: "Test", areaM2: 20,
      budgetMinCents: 0, budgetMaxCents: 1000, renovationType: "repair", desiredDays: 5,
      status: ["one", "two"].includes(id) ? "contracted" : "published" })) });
    await db.quote.createMany({ data: ["one", "two"].map(id => ({ id: `q-${id}`, demandId: id, providerId: `p-${id}`,
      source: id === "one" ? "mock" : "live", status: "accepted", itemsJson: "[]", pendingItemsJson: "[]", knownTotalCents: 0, estimatedDays: 5 })) });
    await db.serviceOrder.createMany({ data: ["one", "two"].map(id => ({ id: `o-${id}`, demandId: id, providerId: `p-${id}`,
      acceptedQuoteId: `q-${id}`, source: id === "one" ? "mock" : "live", status: "contracted" })) });
  });
  const read = (id = "one", credential = cookie, client: Database = db) => handleOrderProgressHistory(request(credential, `?demandId=${encodeURIComponent(id)}`), client);
  const advance = async (action: string, version: number | null = null, taskId?: string, id = "one", credential = cookie) => {
    const response = await handleOrderProgress(new Request(`${origin}/api/order/progress`, { method: "POST",
      headers: { origin, cookie: credential, "content-type": "application/json" },
      body: JSON.stringify({ demandId: id, orderId: `o-${id}`, action, confirmed: true, scheduleVersion: version, ...(taskId ? { taskId } : {}) }) }), db);
    assert.equal(response.status, 200); return envelope(OrderProgressResult).parse(await response.json());
  };
  const snapshot = async () => ({ demands: await db.demandOrder.findMany(), orders: await db.serviceOrder.findMany(),
    quotes: await db.quote.findMany(), schedules: await db.schedule.findMany(), events: await db.orderProgressEvent.findMany() });

  await t.test("正常履约产生四类记录，重放不重复，读取不写库且不泄露身份", async () => {
    await db.schedule.create({ data: { demandId: "one", version: 1, tasksJson: JSON.stringify([
      { id: "first", name: "合成工序", startDay: 0, durationDays: 1, dependsOn: [], status: "pending", responsibleProviderId: null },
    ]) } });
    await advance("start", 1); await advance("start", 1);
    await advance("start_task", 1, "first"); await advance("complete_task", 2, "first");
    await advance("complete", 3); await advance("complete", 3);
    const before = await snapshot(); const result = await checked(await read(), 200);
    assert.equal(result.meta.source, "mock"); assert.equal(result.data.length, 4);
    const rows = await db.orderProgressEvent.findMany({ where: { orderId: "o-one" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    assert.deepEqual(result.data, rows.map(({ actorId: _actor, createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString(), source: "mock" })));
    assert.deepEqual(result.data.map((event: OrderProgressEventDTO) => event.action).sort(), ["complete", "complete_task", "start", "start_task"]);
    assert.deepEqual(await checked(await read(), 200), result);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test("同时间按 ID 稳定排序，来源沿用实际接单且 mock 不升级", async () => {
    await advance("start"); await advance("complete");
    await advance("start", null, undefined, "two", otherCookie); await advance("complete", null, undefined, "two", otherCookie);
    await db.orderProgressEvent.updateMany({ data: { createdAt: new Date("2026-11-14T00:00:00.000Z") } });
    for (const [id, credential, source] of [["one", cookie, "mock"], ["two", otherCookie, "live"]]) {
      const result = await checked(await read(id, credential), 200);
      assert.equal(result.meta.source, source); assert.equal(result.data.length, 2);
      assert.ok(result.data.every((event: OrderProgressEventDTO) => event.source === source && event.orderId === `o-${id}`));
      const ids = result.data.map((event: OrderProgressEventDTO) => event.id); assert.deepEqual(ids, [...ids].sort());
    }
  });
  await t.test("合法空态、固定演示来源及精确 ID；历史完成接单不补造记录", async () => {
    for (const [id, source] of [["one", "mock"], ["two", "live"], ["empty", "live"], ["demo-demand", "mock"], [" one ", "live"]]) {
      assert.deepEqual(await checked(await read(id, id === "two" ? otherCookie : cookie), 200), { ok: true, data: [], meta: { source } });
    }
    await db.demandOrder.update({ where: { id: "one" }, data: { status: "completed" } });
    await db.serviceOrder.update({ where: { id: "o-one" }, data: { status: "completed" } });
    assert.deepEqual((await checked(await read(), 200)).data, []); assert.equal(await db.orderProgressEvent.count(), 0);
    await checked(await handleOrderProgressHistory(request(cookie, "?demandId=one", "HEAD"), db), 200);
  });
  await t.test("跨业主与不存在统一 404，公开或演示需求也没有匿名历史入口", async () => {
    const missing = await checked(await read("missing"), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(await checked(await read("two"), 404, "DEMAND_NOT_FOUND"), missing);
    for (const id of ["one", "empty", "demo-demand"]) {
      assert.deepEqual(await checked(await read(id, otherCookie), 404, "DEMAND_NOT_FOUND"), missing);
      await checked(await read(id, ""), 401, "UNAUTHENTICATED");
    }
  });
  await t.test("缺失/重复/额外/空白参数先拒绝，不查询数据库", async () => {
    const never = { $transaction: async () => { assert.fail("invalid query must not read storage"); } } as unknown as Database;
    for (const query of ["", "?demandId=", "?demandId=%20", "?demandId=one&demandId=one", "?demandId=one&ownerId=owner", "?orderId=o-one", "?demandId=one&source=live"]) {
      await checked(await handleOrderProgressHistory(request(cookie, query), never), 400, "VALIDATION_ERROR");
    }
    await checked(await handleOrderProgressHistory(request(cookie, "?demandId=one", "POST"), never), 403, "FORBIDDEN");
  });
  await t.test("坏/重复/过期/撤销会话、服务方身份和角色变化拒绝", async () => {
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
  await t.test("会话、角色和需求归属均在读取事务内重新检查", async () => {
    for (const [change, status, code] of [
      [async (tx: Prisma.TransactionClient) => { await tx.ownerSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } }); }, 401, "UNAUTHENTICATED"],
      [async (tx: Prisma.TransactionClient) => { await tx.user.update({ where: { id: "owner" }, data: { role: "provider" } }); }, 403, "FORBIDDEN"],
      [async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "other" } }); }, 404, "DEMAND_NOT_FOUND"],
    ] as const) await checked(await read("one", cookie, decorate(db, async tx => { await change(tx); return tx; })), status, code);
  });
  await t.test("缺失接单或来源/报价关联损坏返回 503，不伪装空记录", async () => {
    for (const status of ["contracted", "in_progress", "completed", "broken"]) {
      await db.demandOrder.update({ where: { id: "empty" }, data: { status } }); await checked(await read("empty"), 503, "ORDER_PROGRESS_UNAVAILABLE");
    }
    for (const change of [
      async (tx: Prisma.TransactionClient) => { await tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "unknown" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "live" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.serviceOrder.update({ where: { id: "o-one" }, data: { providerId: "p-two" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { status: "completed" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.quote.update({ where: { id: "q-one" }, data: { status: "submitted" } }); },
      async (tx: Prisma.TransactionClient) => { await tx.quote.update({ where: { id: "q-one" }, data: { itemsJson: "broken" } }); },
    ]) await checked(await read("one", cookie, decorate(db, async tx => { await change(tx); return tx; })), 503, "ORDER_PROGRESS_UNAVAILABLE");
  });
  await t.test("坏事件字段和与当前接单矛盾的完成动作均拒绝，不过滤后成功", async () => {
    await advance("start");
    for (const data of [{ action: "broken" }, { fromStatus: "completed" }, { taskId: "first" }, { scheduleVersion: -1 },
      { action: "complete", fromStatus: "in_progress", toStatus: "completed" },
      { action: "start_task", fromStatus: "in_progress", toStatus: "in_progress", scheduleVersion: 2, taskId: null },
    ]) await checked(await read("one", cookie, decorate(db, async tx => {
      await tx.orderProgressEvent.updateMany({ where: { orderId: "o-one" }, data }); return tx;
    })), 503, "ORDER_PROGRESS_UNAVAILABLE");
    await checked(await read("one", cookie, decorate(db, async tx => {
      await tx.demandOrder.update({ where: { id: "one" }, data: { status: "contracted" } });
      await tx.serviceOrder.update({ where: { id: "o-one" }, data: { status: "contracted" } }); return tx;
    })), 503, "ORDER_PROGRESS_UNAVAILABLE");
  });
  await t.test("事件 SQL 限定当前订单/需求/业主，只选公开字段；越界返回与重复 ID 拒绝", async () => {
    await advance("start"); await advance("start", null, undefined, "two", otherCookie);
    for (const mode of ["normal", "other", "duplicate", "invalid date"]) {
      const client = decorate(db, async tx => ({ ...tx, orderProgressEvent: { ...tx.orderProgressEvent,
        findMany: async (args: Prisma.OrderProgressEventFindManyArgs) => {
          assert.deepEqual(args.where, { orderId: "o-one", order: { demandId: "one", demand: { ownerId: "owner" } } });
          assert.deepEqual(args.select, { id: true, orderId: true, action: true, fromStatus: true, toStatus: true, taskId: true, scheduleVersion: true, createdAt: true });
          assert.deepEqual(args.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
          const rows = await tx.orderProgressEvent.findMany({ ...args, ...(mode === "other" ? { where: { orderId: "o-two" } } : {}) });
          return mode === "duplicate" ? [...rows, ...rows] : mode === "invalid date" ? rows.map(row => ({ ...row, createdAt: new Date(NaN) })) : rows;
        },
      } }) as unknown as Prisma.TransactionClient);
      await checked(await read("one", cookie, client), mode === "normal" ? 200 : 503, mode === "normal" ? undefined : "ORDER_PROGRESS_UNAVAILABLE");
    }
  });
  await t.test("查询中存储失败或意外返回其他接单不暴露内容", async () => {
    const broken = { $transaction: async () => { throw new Error("private database"); } } as unknown as Database;
    await checked(await read("one", cookie, broken), 503, "ORDER_PROGRESS_UNAVAILABLE");
    const escaped = decorate(db, async tx => ({ ...tx, serviceOrder: { ...tx.serviceOrder,
      findFirst: (args: Prisma.ServiceOrderFindFirstArgs) => tx.serviceOrder.findFirst({ ...args, where: { demandId: "two" } }),
    } }) as unknown as Prisma.TransactionClient);
    await checked(await read("one", cookie, escaped), 503, "ORDER_PROGRESS_UNAVAILABLE");
  });
});
