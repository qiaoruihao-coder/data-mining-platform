import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { OrderProgressInput, OrderProgressResult, SQLITE_INT_MAX, envelope } from "../src/contracts";
import { handleOrderProgress } from "../src/lib/order-progress";
import { handleReviewCreate } from "../src/lib/review";
import { handleScheduleRevision } from "../src/lib/schedule-revision";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const input = { demandId: "one", orderId: "o-one", action: "start", scheduleVersion: null, confirmed: true };
const tasks = [
  { id: "first", name: "合成第一工序", startDay: 0, durationDays: 1, dependsOn: [], responsibleProviderId: null, status: "pending" },
  { id: "second", name: "合成后续工序", startDay: 1, durationDays: 1, dependsOn: ["first"], responsibleProviderId: null, status: "pending" },
];
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body: unknown = input) => new Request(`${origin}/api/order/progress`, {
  method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
});
async function denied(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  const body = await response.json(); assert.equal(body.ok, false); assert.equal(body.error.code, code);
  assert.equal("data" in body, false); assert.equal("meta" in body, false); assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|actorId|itemsJson/);
}
async function success(response: Response) {
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  const body = envelope(OrderProgressResult).parse(await response.json()); assert.equal(body.meta.source, body.data.order.source);
  assert.doesNotMatch(JSON.stringify(body), /actorId|tokenHash|ownerId/); return body;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable"); return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}

test("履约契约：显式确认和排期快照，工序动作有目标，拒绝任意状态/身份", () => {
  assert.ok(OrderProgressInput.safeParse(input).success);
  assert.equal(OrderProgressInput.parse({ ...input, demandId: " one " }).demandId, " one ");
  for (const action of ["start_task", "complete_task"]) assert.ok(OrderProgressInput.safeParse({ ...input, action, taskId: "first", scheduleVersion: 1 }).success);
  for (const fields of [{ confirmed: false }, { confirmed: undefined }, { action: "finish" }, { action: "start_task" }, { action: "complete_task", taskId: " " },
    { scheduleVersion: undefined }, { scheduleVersion: 0 }, { scheduleVersion: 1.5 }, { scheduleVersion: SQLITE_INT_MAX + 1 }, { scheduleVersion: "1" },
    { orderId: " " }, { demandId: " " }, { ownerId: "other" }, { source: "live" }, { status: "completed" }, { taskId: "unexpected" }]) {
    assert.equal(OrderProgressInput.safeParse({ ...input, ...fields }).success, false);
  }
});

test("履约：隔离 SQLite 验证两侧原子推进、工序依赖、历史、来源与回滚", async t => {
  const tempRoot = resolve(tmpdir()); const fixture = mkdtempSync(join(tempRoot, "ai-home-D-progress-"));
  const path = join(fixture, "progress.db"); const url = `file:${path.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } }); const second = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await db.$disconnect(); await second.$disconnect(); assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-progress-")); rmSync(fixture, { recursive: true, force: true }); });
  writeFileSync(path, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 30000,
  });
  await db.user.createMany({ data: ["owner", "other"].map(id => ({ id, name: "Synthetic owner", role: "owner" })) });
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: "owner", role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: "other", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  await db.serviceProvider.createMany({ data: ["provider-a", "provider-b"].map(id => ({ id, name: "Synthetic", city: "Test", kind: "construction", tagsJson: "[]", rating: 3 })) });
  t.beforeEach(async () => {
    await db.user.update({ where: { id: "owner" }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { userId: "owner", revokedAt: null, expiresAt: issued.expiresAt } });
    await db.orderProgressEvent.deleteMany(); await db.review.deleteMany(); await db.schedule.deleteMany();
    await db.serviceOrder.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: ["one", "two", "demo-demand", "empty"].map(id => ({ id, ownerId: id === "two" ? "other" : "owner",
      description: "Synthetic demand", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 10, status: "contracted" })) });
    await db.quote.createMany({ data: ["one", "two"].map(id => ({ id: `q-${id}`, demandId: id, providerId: "provider-a", source: "mock", status: "accepted",
      itemsJson: '[{"code":"pending","name":"待定","unit":"job","quantity":1,"unitPriceCents":null,"amountCents":null,"note":"合成"}]', pendingItemsJson: '["待定"]', knownTotalCents: 0, estimatedDays: 5 })) });
    await db.serviceOrder.createMany({ data: ["one", "two"].map(id => ({ id: `o-${id}`, demandId: id, providerId: "provider-a", acceptedQuoteId: `q-${id}`, status: "contracted", source: "mock" })) });
  });
  const advance = (fields: Record<string, unknown> = {}, client: Database = db, credential = cookie) => handleOrderProgress(request(credential, { ...input, ...fields }), client);
  const plan = (fields: Record<string, unknown> = {}) => db.schedule.create({ data: { demandId: "one", version: 1, tasksJson: JSON.stringify(tasks), ...fields } });
  const snapshot = async () => ({ demands: await db.demandOrder.findMany(), orders: await db.serviceOrder.findMany(), quotes: await db.quote.findMany(),
    schedules: await db.schedule.findMany(), events: await db.orderProgressEvent.findMany() });
  const checkStatus = async (status: string) => {
    assert.equal((await second.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).status, status);
    assert.equal((await second.serviceOrder.findUniqueOrThrow({ where: { id: "o-one" } })).status, status);
  };

  await t.test("无排期正常推进到可评价，同态重放不重复事件；报价/待定费用/来源不变", async () => {
    const before = await db.quote.findMany();
    await denied(await advance({ action: "complete" }), 409, "ORDER_PROGRESS_NOT_ALLOWED");
    const started = await success(await advance()); assert.equal(started.data.order.status, "in_progress"); assert.equal(started.data.schedule, null);
    assert.equal(started.meta.source, "mock"); await checkStatus("in_progress");
    assert.deepEqual(await success(await advance()), started); assert.equal(await db.orderProgressEvent.count(), 1);
    const completed = await success(await advance({ action: "complete" })); await checkStatus("completed");
    assert.deepEqual(await success(await advance({ action: "complete" })), completed); assert.equal(await db.orderProgressEvent.count(), 2);
    await denied(await advance(), 409, "ORDER_PROGRESS_NOT_ALLOWED");
    const review = await handleReviewCreate(new Request(`${origin}/api/review`, { method: "POST", headers: { origin, cookie },
      body: JSON.stringify({ demandId: "one", providerId: "provider-a", rating: 5, comment: "合成验收" }) }), db);
    assert.equal(review.status, 201); assert.equal((await review.json()).meta.source, "mock");
    assert.deepEqual(await db.quote.findMany(), before);
    const events = await db.orderProgressEvent.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map(event => [event.actorId, event.action, event.fromStatus, event.toStatus, event.scheduleVersion, event.taskId]),
      [["owner", "start", "contracted", "in_progress", null, null], ["owner", "complete", "in_progress", "completed", null, null]]);
    assert.equal((await db.serviceProvider.findUniqueOrThrow({ where: { id: "provider-a" } })).rating, 3);
  });

  await t.test("live 接单来源保持，不新增模拟输出", async () => {
    await db.quote.update({ where: { id: "q-one" }, data: { source: "live" } });
    await db.serviceOrder.update({ where: { id: "o-one" }, data: { source: "live" } });
    assert.equal((await success(await advance())).meta.source, "live");
    assert.equal((await success(await advance({ action: "complete" }))).data.order.source, "live");
  });

  await t.test("有排期按依赖开工/确认完成；追加版本，保留历史与责任方，不代替支付", async () => {
    const original = tasks.map(task => ({ ...task, responsibleProviderId: "provider-a" })); await plan({ tasksJson: JSON.stringify(original) });
    await success(await advance({ scheduleVersion: 1 })); await checkStatus("in_progress");
    await denied(await advance({ action: "complete", scheduleVersion: 1 }), 409, "SCHEDULE_NOT_COMPLETE");
    await denied(await advance({ action: "start_task", taskId: "second", scheduleVersion: 1 }), 409, "TASK_PROGRESS_NOT_ALLOWED");
    await denied(await advance({ action: "complete_task", taskId: "first", scheduleVersion: 1 }), 409, "TASK_PROGRESS_NOT_ALLOWED");
    let version = 1;
    for (const taskId of ["first", "second"]) for (const action of ["start_task", "complete_task"]) {
      const moved = await success(await advance({ action, taskId, scheduleVersion: version }));
      assert.equal(moved.data.schedule!.version, version + 1); await checkStatus("in_progress");
      await denied(await advance({ action, taskId, scheduleVersion: version }), 409, "SCHEDULE_VERSION_CONFLICT");
      version++;
      assert.deepEqual(await success(await advance({ action, taskId, scheduleVersion: version })), moved);
    }
    const result = await success(await advance({ action: "complete", scheduleVersion: version })); await checkStatus("completed");
    assert.equal(await db.schedule.count(), 5); assert.equal(await db.orderProgressEvent.count(), 6);
    assert.deepEqual(JSON.parse((await db.schedule.findUniqueOrThrow({ where: { demandId_version: { demandId: "one", version: 1 } } })).tasksJson), original);
    assert.deepEqual(result.data.schedule!.tasks, original.map(task => ({ ...task, status: "done" })));
    await denied(await advance({ action: "start_task", taskId: "first", scheduleVersion: version }), 409, "ORDER_PROGRESS_NOT_ALLOWED");
    assert.equal(await db.payment.count(), 0);
  });

  await t.test("精确排期版本包括 null；未知工序/无排期/版本耗尽不能推进", async () => {
    await denied(await advance({ scheduleVersion: 1 }), 409, "SCHEDULE_VERSION_CONFLICT");
    await success(await advance());
    await denied(await advance({ action: "start_task", taskId: "first" }), 409, "SCHEDULE_PROGRESS_NOT_ALLOWED");
    await plan();
    for (const version of [null, 2]) await denied(await advance({ action: "complete", scheduleVersion: version }), 409, "SCHEDULE_VERSION_CONFLICT");
    await denied(await advance({ action: "start_task", taskId: " first ", scheduleVersion: 1 }), 404, "TASK_NOT_FOUND");
    await db.schedule.updateMany({ data: { version: SQLITE_INT_MAX } });
    await denied(await advance({ action: "start_task", taskId: "first", scheduleVersion: SQLITE_INT_MAX }), 409, "SCHEDULE_PROGRESS_NOT_ALLOWED");
  });

  await t.test("匿名/坏/重复/仅服务方 cookie 和跨源在读正文前被拒绝", async () => {
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=invalid`, `${cookie}; ${cookie}`, "ai_home_demo_session=synthetic"]) {
      const req = request(credential); await denied(await handleOrderProgress(req, db), 401, "UNAUTHENTICATED"); assert.equal(req.bodyUsed, false);
    }
    const headers: Record<string, string>[] = [{}, { origin: "https://other.example" }, { origin, "sec-fetch-site": "cross-site" }];
    for (const fields of headers) {
      const req = new Request(`${origin}/api/order/progress`, { method: "POST", headers: { cookie, ...fields }, body: "{}" });
      await denied(await handleOrderProgress(req, db), 403, "FORBIDDEN"); assert.equal(req.bodyUsed, false);
    }
    await checkStatus("contracted"); assert.equal(await db.orderProgressEvent.count(), 0);
  });

  await t.test("过期/撤销/角色变更及双 cookie 均不能重放", async () => {
    await success(await advance());
    for (const data of [{ expiresAt: new Date(0) }, { expiresAt: issued.expiresAt, revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data });
      await denied(await advance({}, db, `${cookie}; ai_home_demo_session=synthetic`), 401, "UNAUTHENTICATED");
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: "owner" }, data: { role } }); await denied(await advance(), 403, "FORBIDDEN");
    }
    assert.equal(await db.orderProgressEvent.count(), 1);
  });

  await t.test("跨业主/不存在统一 404；目标接单必须属于需求，演示只读", async () => {
    for (const demandId of ["two", "missing", " one "]) await denied(await advance({ demandId }), 404, "DEMAND_NOT_FOUND");
    await denied(await advance({}, db, otherCookie), 404, "DEMAND_NOT_FOUND");
    for (const orderId of ["o-two", "missing", " o-one "]) await denied(await advance({ orderId }), 404, "ORDER_NOT_FOUND");
    await denied(await advance({ demandId: "empty" }), 404, "ORDER_NOT_FOUND");
    await denied(await advance({ demandId: "demo-demand" }), 409, "DEMO_DEMAND_READ_ONLY");
    await checkStatus("contracted");
  });

  await t.test("非法请求、坏 JSON、未知参数与超限 UTF-8 正文不写入", async () => {
    for (const query of ["?ownerId=owner", "?demandId=one", "?unknown="]) await denied(await handleOrderProgress(new Request(`${origin}/api/order/progress${query}`, { method: "POST", headers: { origin, cookie } }), db), 400, "VALIDATION_ERROR");
    for (const body of [undefined, "{"]) await denied(await handleOrderProgress(new Request(`${origin}/api/order/progress`, { method: "POST", headers: { origin, cookie }, body }), db), 400, "INVALID_JSON");
    for (const fields of [{ confirmed: false }, { status: "completed" }, { huge: "测".repeat(3000) }]) await denied(await advance(fields), 400, "VALIDATION_ERROR");
    await checkStatus("contracted"); assert.equal(await db.orderProgressEvent.count(), 0);
  });

  await t.test("坏接单/报价关系和不一致状态返回 503，不能以推进修复", async () => {
    const changes: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [
      tx => tx.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } }),
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "unknown" } }),
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "live" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { providerId: "provider-b" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { demandId: "two" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { status: "submitted" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { itemsJson: "broken" } }),
    ];
    const before = await snapshot();
    for (const change of changes) {
      let calls = 0; const client = decorate(db, async tx => { if (++calls === 2) await change(tx); return tx; });
      await denied(await advance({}, client), 503, "ORDER_PROGRESS_UNAVAILABLE"); assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test("坏排期图/提前完成依赖拒绝；责任方冲突与 blocked 不绕过", async () => {
    const invalid = ["broken", "[]", JSON.stringify([tasks[0], tasks[0]]), JSON.stringify([{ ...tasks[0], dependsOn: ["missing"] }]),
      JSON.stringify([tasks[0], { ...tasks[1], status: "done" }]), JSON.stringify([{ ...tasks[0], startDay: SQLITE_INT_MAX, durationDays: 2 }])];
    for (const tasksJson of invalid) {
      await plan({ tasksJson }); await denied(await advance({ scheduleVersion: 1 }), 503, "ORDER_PROGRESS_UNAVAILABLE"); await db.schedule.deleteMany();
    }
    await plan({ tasksJson: JSON.stringify(tasks.map(task => ({ ...task, responsibleProviderId: "provider-b" }))) });
    await denied(await advance({ scheduleVersion: 1 }), 409, "SCHEDULE_PROGRESS_NOT_ALLOWED"); await db.schedule.deleteMany();
    await plan({ tasksJson: JSON.stringify([{ ...tasks[0], status: "blocked" }, tasks[1]]) });
    await denied(await advance({ scheduleVersion: 1 }), 409, "SCHEDULE_PROGRESS_NOT_ALLOWED");
    await db.$transaction([db.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } }), db.serviceOrder.update({ where: { id: "o-one" }, data: { status: "in_progress" } })]);
    await denied(await advance({ action: "complete", scheduleVersion: 1 }), 409, "SCHEDULE_NOT_COMPLETE");
    await denied(await advance({ action: "start_task", taskId: "first", scheduleVersion: 1 }), 409, "TASK_PROGRESS_NOT_ALLOWED");
  });

  await t.test("写事务内身份/角色/归属变化拒绝，撤销不因预检而失效", async () => {
    const changes: [number, string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
      [401, "UNAUTHENTICATED", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })],
      [403, "FORBIDDEN", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { userId: "other" } })],
      [403, "FORBIDDEN", tx => tx.user.update({ where: { id: "owner" }, data: { role: "admin" } })],
      [404, "DEMAND_NOT_FOUND", tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "other" } })],
    ];
    for (const [status, code, change] of changes) {
      let calls = 0; const client = decorate(db, async tx => { if (++calls === 2) await change(tx); return tx; });
      await denied(await advance({}, client), status, code); await checkStatus("contracted"); assert.equal(await db.orderProgressEvent.count(), 0);
    }
  });

  await t.test("最终 SQL 限制旧状态、归属、原报价与排期快照；竞争变化回滚", async () => {
    const changes: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [
      tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "other" } }),
      tx => tx.demandOrder.update({ where: { id: "one" }, data: { status: "completed" } }),
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { status: "in_progress" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { itemsJson: "[]" } }),
      tx => tx.schedule.create({ data: { demandId: "one", version: 1, tasksJson: JSON.stringify(tasks) } }),
    ];
    const before = await snapshot();
    for (const change of changes) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        updateMany: async (args: Prisma.DemandOrderUpdateManyArgs) => { await change(tx); return tx.demandOrder.updateMany(args); },
      } } as unknown as Prisma.TransactionClient));
      await denied(await advance({}, client), 503, "ORDER_PROGRESS_UNAVAILABLE"); assert.deepEqual(await snapshot(), before);
    }
    await plan(); const scheduled = await snapshot();
    for (const change of [async (tx: Prisma.TransactionClient) => tx.schedule.updateMany({ data: { tasksJson: JSON.stringify([tasks[0]]) } }),
      async (tx: Prisma.TransactionClient) => tx.schedule.create({ data: { demandId: "one", version: 2, tasksJson: JSON.stringify(tasks) } })]) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        updateMany: async (args: Prisma.DemandOrderUpdateManyArgs) => { await change(tx); return tx.demandOrder.updateMany(args); },
      } } as unknown as Prisma.TransactionClient));
      await denied(await advance({ scheduleVersion: 1 }, client), 503, "ORDER_PROGRESS_UNAVAILABLE"); assert.deepEqual(await snapshot(), scheduled);
    }
  });

  await t.test("接单更新失败、事件失败、输出坏数据使需求也回滚；数据库故障无泄露", async () => {
    const before = await snapshot();
    const transforms = [
      async (tx: Prisma.TransactionClient) => ({ ...tx, serviceOrder: { ...tx.serviceOrder, updateMany: async () => ({ count: 0 }) } }),
      async (tx: Prisma.TransactionClient) => ({ ...tx, orderProgressEvent: { ...tx.orderProgressEvent, create: async () => { throw new Error("private database"); } } }),
      async (tx: Prisma.TransactionClient) => ({ ...tx, serviceOrder: { ...tx.serviceOrder, findFirstOrThrow: async (args: Prisma.ServiceOrderFindFirstOrThrowArgs) => ({ ...await tx.serviceOrder.findFirstOrThrow(args), status: "broken" }) } }),
    ];
    for (const transform of transforms) {
      await denied(await advance({}, decorate(db, transform as unknown as (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>)), 503, "ORDER_PROGRESS_UNAVAILABLE");
      assert.deepEqual(await snapshot(), before);
    }
    const down = { $transaction: async () => { throw new Error("private database"); } } as unknown as Database;
    await denied(await advance({}, down), 503, "ORDER_PROGRESS_UNAVAILABLE");
    await plan(); await success(await advance({ scheduleVersion: 1 })); const started = await snapshot();
    const client = decorate(db, async tx => ({ ...tx, schedule: { ...tx.schedule, create: async () => { throw new Error("private database"); } } } as unknown as Prisma.TransactionClient));
    await denied(await advance({ action: "start_task", taskId: "first", scheduleVersion: 1 }, client), 503, "ORDER_PROGRESS_UNAVAILABLE"); assert.deepEqual(await snapshot(), started);
  });

  await t.test("两连接并发开工/工序推进至多一次实际变更；版本竞争不覆盖", async () => {
    await plan();
    const starts = await Promise.all([advance({ scheduleVersion: 1 }), advance({ scheduleVersion: 1 }, second)]);
    assert.ok(starts.some(response => response.status === 200)); assert.ok(starts.every(response => [200, 503].includes(response.status)));
    await checkStatus("in_progress"); assert.equal(await db.orderProgressEvent.count(), 1);
    const moved = await Promise.all([advance({ action: "start_task", taskId: "first", scheduleVersion: 1 }), advance({ action: "start_task", taskId: "first", scheduleVersion: 1 }, second)]);
    assert.equal(moved.filter(response => response.status === 200).length, 1); assert.ok(moved.every(response => [200, 409, 503].includes(response.status)));
    assert.equal(await db.schedule.count(), 2); assert.equal(await db.orderProgressEvent.count(), 2); await checkStatus("in_progress");
  });

  await t.test("修订排期与开工竞争最多一个成功，已开工不能再修改计划", async () => {
    await plan();
    const revision = new Request(`${origin}/api/schedule`, { method: "PUT", headers: { origin, cookie }, body: JSON.stringify({ demandId: "one", baseVersion: 1, confirmed: true,
      tasks: tasks.map(({ id, name, startDay, durationDays, dependsOn }) => ({ id, name, startDay, durationDays, dependsOn })) }) });
    const responses = await Promise.all([advance({ scheduleVersion: 1 }), handleScheduleRevision(revision, second)]);
    assert.equal(responses.filter(response => response.ok).length, 1);
    assert.ok(responses.every(response => [200, 201, 409, 503].includes(response.status)));
    const order = await db.serviceOrder.findUniqueOrThrow({ where: { id: "o-one" } }); await checkStatus(order.status);
    assert.equal(await db.schedule.count(), order.status === "contracted" ? 2 : 1);
  });
});
