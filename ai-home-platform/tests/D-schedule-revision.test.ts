import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Schedule, ScheduleCreateInput, ScheduleRevisionInput, SQLITE_INT_MAX, envelope } from "../src/contracts";
import { handleScheduleRevision } from "../src/lib/schedule-revision";
import { handleScheduleRead } from "../src/lib/schedule-read";
import { createOwnerAccount } from "../src/lib/owner-account";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const password = "Synthetic-schedule-revision-password-42";
const tasks = [
  { id: "prepare", name: "准备", startDay: 0, durationDays: 1, dependsOn: [] },
  { id: "work", name: "施工计划", startDay: 1, durationDays: 3, dependsOn: ["prepare"] },
];
const oldTasks = tasks.map(task => ({ ...task, status: "pending", responsibleProviderId: null }));
const input = { demandId: "one", baseVersion: 1, confirmed: true, tasks: [tasks[0], { ...tasks[1], durationDays: 5 }] };
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body: unknown = input) => new Request(`${origin}/api/schedule`, {
  method: "PUT", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
});
function noCache(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  noCache(response); assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal("data" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|tasksJson/);
  return body;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}

test("修订契约要求明确确认及可递增版本，复用首版工序规则并拒绝控制字段", () => {
  const valid = ScheduleRevisionInput.parse({ ...input, demandId: " one ", tasks: [
    { ...tasks[0], name: " 准备 " }, tasks[1], { ...tasks[0], id: "parallel" },
  ] });
  assert.equal(valid.demandId, " one "); assert.equal(valid.tasks[0].name, "准备");
  assert.ok(ScheduleRevisionInput.safeParse({ ...input, baseVersion: SQLITE_INT_MAX - 1 }).success);
  for (const baseVersion of [0, -1, 1.5, "1", null, undefined, Infinity, SQLITE_INT_MAX]) {
    assert.equal(ScheduleRevisionInput.safeParse({ ...input, baseVersion }).success, false);
  }
  for (const confirmed of [false, "true", 1, null, undefined]) assert.equal(ScheduleRevisionInput.safeParse({ ...input, confirmed }).success, false);
  for (const fields of [{ ownerId: "owner" }, { version: 2 }, { source: "live" }, { meta: { source: "live" } }, { reason: "not supported" }]) {
    assert.equal(ScheduleRevisionInput.safeParse({ ...input, ...fields }).success, false);
  }
  const invalid = [[], [tasks[0], tasks[0]], [{ ...tasks[0], name: " " }], [{ ...tasks[0], id: " " }],
    [{ ...tasks[0], durationDays: 0 }], [{ ...tasks[0], startDay: SQLITE_INT_MAX }],
    [{ ...tasks[0], dependsOn: ["missing"] }], [{ ...tasks[0], dependsOn: [tasks[0].id] }],
    [tasks[0], { ...tasks[1], startDay: 0 }], [tasks[0], { ...tasks[1], dependsOn: [tasks[0].id, tasks[0].id] }],
    [{ ...tasks[0], dependsOn: [tasks[1].id] }, tasks[1]],
    [{ ...tasks[0], status: "done" }], [{ ...tasks[0], responsibleProviderId: null }],
    Array.from({ length: 101 }, (_, i) => ({ ...tasks[0], id: String(i) })),
  ];
  for (const tasks of invalid) {
    assert.equal(ScheduleRevisionInput.safeParse({ ...input, tasks }).success, false);
    assert.equal(ScheduleCreateInput.safeParse({ demandId: input.demandId, tasks }).success, false);
  }
});

test("确认修订排期：隔离 SQLite、并发保护及公开路由", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-schedule-revision-"));
  const databasePath = join(fixture, "schedule.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-schedule-revision-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const owner = await createOwnerAccount({ login: "schedule-revision-one", name: "Synthetic first", password }, db);
  const other = await createOwnerAccount({ login: "schedule-revision-two", name: "Synthetic second", password }, db);
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: owner.userId, role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: other.userId, role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const demands = ["one", "two", "demo-demand", " one "].map(id => ({ id, ownerId: id === "two" ? other.userId : owner.userId,
    description: "Synthetic demand", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000,
    renovationType: "repair", desiredDays: 10, status: "published" }));
  t.beforeEach(async () => {
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { userId: owner.userId, revokedAt: null, expiresAt: issued.expiresAt } });
    await db.schedule.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: demands });
    await db.schedule.createMany({ data: demands.map(demand => ({ id: `plan-${demand.id}`, demandId: demand.id, version: 1, tasksJson: JSON.stringify(oldTasks) })) });
  });
  const revise = (value: unknown = input, credential = cookie, client: Database = db) => handleScheduleRevision(request(credential, value), client);
  const read = (id = "one", version?: number, credential = cookie) => handleScheduleRead(new Request(
    `${origin}/api/schedule?demandId=${encodeURIComponent(id)}${version ? `&version=${version}` : ""}`, { headers: { cookie: credential } }), second);
  const snapshot = () => db.schedule.findMany({ orderBy: { id: "asc" } });

  await t.test("v1→v2→v3 只追加，另一连接读取最新/旧版一致，需求状态不变", async () => {
    for (const [id, status] of [["one", "published"], [" one ", "contracted"]]) {
      await db.demandOrder.update({ where: { id }, data: { status } });
      const original = await db.schedule.findUniqueOrThrow({ where: { id: `plan-${id}` } });
      const initial = await (await read(id, 1)).json();
      for (const baseVersion of [1, 2]) {
        const planTasks = baseVersion === 1 ? input.tasks : [{ ...tasks[0], id: "replacement", durationDays: 4 }];
        const response = await revise({ ...input, demandId: id, baseVersion, tasks: planTasks });
        noCache(response); assert.equal(response.status, 201);
        const body = envelope(Schedule).parse(await response.json());
        assert.deepEqual(body, { ok: true, data: { demandId: id, version: baseVersion + 1,
          tasks: planTasks.map(task => ({ ...task, responsibleProviderId: null, status: "pending" })) }, meta: { source: "live" } });
        for (const version of [undefined, baseVersion + 1]) {
          const result = await read(id, version); assert.equal(result.status, 200); assert.deepEqual(await result.json(), body);
        }
        assert.deepEqual(await (await read(id, 1)).json(), initial);
        assert.deepEqual(await db.schedule.findUniqueOrThrow({ where: { id: original.id } }), original);
      }
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id } })).status, status);
      assert.equal(await db.schedule.count({ where: { demandId: id } }), 3);
    }
  });

  await t.test("旧版、未来版、重复请求返回版本冲突，不产生额外版本", async () => {
    await denied(await revise({ ...input, baseVersion: 2 }), 409, "SCHEDULE_VERSION_CONFLICT");
    assert.equal((await revise()).status, 201);
    const saved = await snapshot();
    await denied(await revise(), 409, "SCHEDULE_VERSION_CONFLICT");
    await denied(await revise({ ...input, baseVersion: 3 }), 409, "SCHEDULE_VERSION_CONFLICT");
    assert.deepEqual(await snapshot(), saved);
  });

  await t.test("同源和身份预检先于正文，匿名、重复/坏业主 cookie 和仅服务方不能修订", async () => {
    const saved = await snapshot();
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, "ai_home_demo_session=synthetic-provider"]) {
      const req = request(credential); await denied(await handleScheduleRevision(req, db), 401, "UNAUTHENTICATED"); assert.equal(req.bodyUsed, false);
    }
    const forbiddenHeaders: Record<string, string>[] = [{}, { origin: "https://other.example" }, { origin, "sec-fetch-site": "cross-site" }];
    for (const header of forbiddenHeaders) {
      const req = new Request(`${origin}/api/schedule`, { method: "PUT", headers: { cookie, ...header }, body: "{}" });
      await denied(await handleScheduleRevision(req, db), 403, "FORBIDDEN"); assert.equal(req.bodyUsed, false);
    }
    assert.deepEqual(await snapshot(), saved);
  });

  await t.test("过期/撤销/角色变化及双 cookie 均不能扩大权限", async () => {
    const saved = await snapshot();
    for (const data of [{ expiresAt: new Date(0) }, { expiresAt: issued.expiresAt, revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data });
      await denied(await revise(input, `${cookie}; ai_home_demo_session=synthetic-provider`), 401, "UNAUTHENTICATED");
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } }); await denied(await revise(), 403, "FORBIDDEN");
    }
    assert.deepEqual(await snapshot(), saved);
  });

  await t.test("跨业主和不存在统一 404，演示只读、无初始排期/非法需求状态拒绝", async () => {
    const missing = await denied(await revise({ ...input, demandId: "missing" }), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(await denied(await revise({ ...input, demandId: "two" }), 404, "DEMAND_NOT_FOUND"), missing);
    await denied(await revise(input, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await revise({ ...input, demandId: "demo-demand" }, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await revise({ ...input, demandId: "demo-demand" }), 409, "DEMO_DEMAND_READ_ONLY");
    for (const status of ["draft", "in_progress", "completed", "unknown"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } }); await denied(await revise(), 409, "INVALID_STATE");
    }
    await db.demandOrder.update({ where: { id: "one" }, data: { status: "published" } });
    await db.schedule.delete({ where: { id: "plan-one" } });
    await denied(await revise(), 404, "SCHEDULE_NOT_FOUND");
    assert.equal(await db.schedule.count({ where: { demandId: "one" } }), 0);
  });

  await t.test("不能用修订重置 active/done/blocked 或已分配责任方的最新计划", async () => {
    for (const change of [{ status: "active" }, { status: "done" }, { status: "blocked" }, { responsibleProviderId: "provider-a" }]) {
      await db.schedule.update({ where: { id: "plan-one" }, data: { tasksJson: JSON.stringify([oldTasks[0], { ...oldTasks[1], ...change }]) } });
      const saved = await snapshot();
      await denied(await revise(), 409, "SCHEDULE_REVISION_NOT_ALLOWED"); assert.deepEqual(await snapshot(), saved);
    }
  });

  await t.test("查询、坏 JSON、缺确认、超大 UTF-8 正文及非法工序拒绝且无新版本", async () => {
    const saved = await snapshot();
    for (const query of ["?demandId=one", "?ownerId=one", "?unknown="]) {
      await denied(await handleScheduleRevision(new Request(`${origin}/api/schedule${query}`, { method: "PUT", headers: { origin, cookie } }), db), 400, "VALIDATION_ERROR");
    }
    for (const body of [undefined, "{"]) {
      await denied(await handleScheduleRevision(new Request(`${origin}/api/schedule`, { method: "PUT", headers: { origin, cookie }, body }), db), 400, "INVALID_JSON");
    }
    for (const value of [{ ...input, confirmed: false }, { ...input, confirmed: undefined }, { ...input, version: 2 },
      { ...input, tasks: [{ ...tasks[0], dependsOn: ["missing"] }] }, { ...input, huge: "测".repeat(23000) }]) {
      await denied(await revise(value), 400, "VALIDATION_ERROR");
    }
    assert.deepEqual(await snapshot(), saved);
  });

  await t.test("损坏的旧计划、错误归属或版本不被新计划覆盖", async () => {
    for (const tasksJson of ["{", "[]", JSON.stringify([{ ...oldTasks[0], status: "invalid" }]),
      JSON.stringify([{ ...oldTasks[0], dependsOn: ["missing"] }]), JSON.stringify([oldTasks[0], oldTasks[0]])]) {
      await db.schedule.update({ where: { id: "plan-one" }, data: { tasksJson } });
      const saved = await snapshot(); await denied(await revise(), 503, "SCHEDULE_UNAVAILABLE"); assert.deepEqual(await snapshot(), saved);
    }
    await db.schedule.update({ where: { id: "plan-one" }, data: { tasksJson: JSON.stringify(oldTasks) } });
    for (const change of [{ demandId: "two" }, { version: 0 }]) {
      const client = decorate(db, async tx => ({ ...tx, schedule: { ...tx.schedule,
        findFirst: async (args: Prisma.ScheduleFindFirstArgs) => ({ ...await tx.schedule.findFirst(args), ...change }),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await revise(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE");
    }
    assert.equal(await db.schedule.count({ where: { demandId: "one" } }), 1);
  });

  await t.test("写事务重验会话/当前角色/身份/归属/版本并回滚中途变化", async () => {
    const saved = await snapshot();
    const changes: [number, string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
      [401, "UNAUTHENTICATED", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })],
      [403, "FORBIDDEN", tx => tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } })],
      [403, "FORBIDDEN", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { userId: other.userId } })],
      [404, "DEMAND_NOT_FOUND", tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } })],
      [409, "SCHEDULE_VERSION_CONFLICT", tx => tx.schedule.create({ data: { demandId: "one", version: 2, tasksJson: JSON.stringify(oldTasks) } })],
    ];
    for (const [status, code, change] of changes) {
      let transactions = 0;
      const client = decorate(db, async tx => { if (++transactions === 2) await change(tx); return tx; });
      await denied(await revise(input, cookie, client), status, code); assert.equal(transactions, 2);
      assert.deepEqual(await snapshot(), saved);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role, "owner");
      assert.equal((await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt, null);
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).ownerId, owner.userId);
    }
  });

  await t.test("最终 SQL 仍限制归属、需求状态、旧版内容和无更新版本", async () => {
    const saved = await snapshot();
    for (const change of [
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } }),
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } }),
      (tx: Prisma.TransactionClient) => tx.schedule.update({ where: { id: "plan-one" }, data: { tasksJson: JSON.stringify([{ ...oldTasks[0], status: "active" }]) } }),
      (tx: Prisma.TransactionClient) => tx.schedule.create({ data: { demandId: "one", version: 3, tasksJson: JSON.stringify(oldTasks) } }),
    ]) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        update: async (args: Prisma.DemandOrderUpdateArgs) => { await change(tx); return tx.demandOrder.update(args); },
      } }) as unknown as Prisma.TransactionClient);
      await denied(await revise(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE"); assert.deepEqual(await snapshot(), saved);
      const row = await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } });
      assert.equal(row.ownerId, owner.userId); assert.equal(row.status, "published");
    }
  });

  await t.test("坏持久化输出或数据库异常回滚新版，保留全部旧数据并隐藏细节", async () => {
    const saved = await snapshot();
    for (const change of [{ tasksJson: "{" }, { demandId: "two" }, { version: 3 }, { tasksJson: "[]" }]) {
      const client = decorate(db, async tx => ({ ...tx, schedule: { ...tx.schedule,
        findUniqueOrThrow: async (args: Prisma.ScheduleFindUniqueOrThrowArgs) => ({ ...await tx.schedule.findUniqueOrThrow(args), ...change }),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await revise(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE"); assert.deepEqual(await snapshot(), saved);
    }
    const client = { $transaction: () => { throw new Error("private database tokenHash"); } } as unknown as Database;
    await denied(await revise(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE");
  });

  await t.test("两连接同基准版本并发只追加一个 v2，重试不能成为 v3", async () => {
    const original = await db.schedule.findUniqueOrThrow({ where: { id: "plan-one" } });
    const responses = await Promise.all([revise(), revise(input, cookie, second)]);
    assert.equal(responses.filter(response => response.status === 201).length, 1);
    for (const response of responses) assert.ok([201, 409, 503].includes(response.status));
    assert.equal(await db.schedule.count({ where: { demandId: "one" } }), 2);
    assert.deepEqual(await db.schedule.findUniqueOrThrow({ where: { id: "plan-one" } }), original);
    const saved = await snapshot(); await denied(await revise(), 409, "SCHEDULE_VERSION_CONFLICT"); assert.deepEqual(await snapshot(), saved);
  });

  await t.test("公开登录→创建需求/v1→PUT v2→GET 历史；旧版、跨业主和退出后修订拒绝", () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    const script = join(fixture, "public-revision.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { POST as login, DELETE as logout } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { POST as demand } from ${modulePath("src/app/api/demand/route.ts")};
      import { POST, PUT, GET } from ${modulePath("src/app/api/schedule/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (path, method = 'GET', cookie = '', body) => new Request('${origin}' + path, { method,
        headers: { origin: '${origin}', cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        const signIn = async loginName => {
          const response = await login(req('/api/auth/owner', 'POST', '', { login: loginName, password: ${JSON.stringify(password)} }));
          assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
        };
        const cookie = await signIn('schedule-revision-one');
        const created = await demand(req('/api/demand', 'POST', cookie, { description: 'Synthetic', city: 'Test', areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000, renovationType: 'repair', desiredDays: 10 }));
        assert.equal(created.status, 201); const id = (await created.json()).data.id;
        const initial = await POST(req('/api/schedule', 'POST', cookie, { demandId: id, tasks: ${JSON.stringify(tasks)} }));
        assert.equal(initial.status, 201); const v1 = await initial.json();
        const input = { ...${JSON.stringify(input)}, demandId: id };
        const response = await PUT(req('/api/schedule', 'PUT', cookie, input));
        assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.meta.source, 'live'); assert.equal(saved.data.version, 2);
        assert.deepEqual(await (await GET(req('/api/schedule?demandId=' + id, 'GET', cookie))).json(), saved);
        assert.deepEqual(await (await GET(req('/api/schedule?demandId=' + id + '&version=1', 'GET', cookie))).json(), v1);
        assert.equal((await PUT(req('/api/schedule', 'PUT', cookie, input))).status, 409);
        const foreign = await signIn('schedule-revision-two');
        assert.equal((await PUT(req('/api/schedule', 'PUT', foreign, { ...input, baseVersion: 2 }))).status, 404);
        assert.equal((await logout(req('/api/auth/owner', 'DELETE', cookie))).status, 200);
        assert.equal((await PUT(req('/api/schedule', 'PUT', cookie, { ...input, baseVersion: 2 }))).status, 401);
        assert.equal(await prisma.schedule.count({ where: { demandId: id } }), 2);
        console.log('public-schedule-revision-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-schedule-revision-ok/);
  });
});
