import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Schedule, ScheduleCreateInput, SQLITE_INT_MAX, envelope } from "../src/contracts";
import { handleScheduleCreate } from "../src/lib/schedule-create";
import { handleScheduleRead } from "../src/lib/schedule-read";
import { createOwnerAccount } from "../src/lib/owner-account";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const password = "Synthetic-schedule-create-password-42";
const input = { demandId: "one", tasks: [
  { id: "prepare", name: " 准备 ", startDay: 0, durationDays: 1, dependsOn: [] },
  { id: "work", name: "施工计划", startDay: 1, durationDays: 3, dependsOn: ["prepare"] },
] };
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body: unknown = input) => new Request(`${origin}/api/schedule`, {
  method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
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

test("创建契约保留精确 ID、规范名称、允许独立并行和前向依赖", () => {
  const parsed = ScheduleCreateInput.parse({ ...input, demandId: " one ", tasks: [...input.tasks].reverse() });
  assert.equal(parsed.demandId, " one "); assert.equal(parsed.tasks[1].name, "准备");
  assert.equal(ScheduleCreateInput.safeParse({ ...input, tasks: [input.tasks[0], { ...input.tasks[0], id: "parallel" }] }).success, true);
  const tasks = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: "合成", startDay: i, durationDays: 1, dependsOn: i ? [String(i - 1)] : [] }));
  assert.equal(ScheduleCreateInput.safeParse({ ...input, tasks }).success, true);
});

test("创建契约拒绝伪造状态身份、无效工序、溢出及有缺陷的依赖图", () => {
  const first = input.tasks[0], second = input.tasks[1];
  const invalidTasks = [[], Array.from({ length: 101 }, (_, i) => ({ ...first, id: String(i) })),
    [first, first], [{ ...first, id: " " }], [{ ...first, id: "x".repeat(129) }],
    [{ ...first, name: " " }], [{ ...first, name: "x".repeat(201) }],
    ...[-1, 0.5, Infinity, SQLITE_INT_MAX + 1].map(startDay => [{ ...first, startDay }]),
    ...[0, -1, 1.5, Infinity, SQLITE_INT_MAX + 1].map(durationDays => [{ ...first, durationDays }]),
    [{ ...first, startDay: SQLITE_INT_MAX }], [{ ...first, dependsOn: [first.id] }],
    [{ ...first, dependsOn: ["missing"] }], [first, { ...second, dependsOn: [first.id, first.id] }],
    [first, { ...second, startDay: 0 }], [{ ...first, dependsOn: [second.id] }, second],
    ...[{ status: "done" }, { responsibleProviderId: "provider-a" }, { acceptance: "accepted" }, { source: "live" }].map(fields => [{ ...first, ...fields }]),
  ];
  for (const tasks of invalidTasks) assert.equal(ScheduleCreateInput.safeParse({ ...input, tasks }).success, false);
  for (const extra of [{ ownerId: "owner" }, { version: 2 }, { status: "done" }, { source: "live" }, { action: "approve" }]) {
    assert.equal(ScheduleCreateInput.safeParse({ ...input, ...extra }).success, false);
  }
  for (const demandId of ["", " ", null]) assert.equal(ScheduleCreateInput.safeParse({ ...input, demandId }).success, false);
});

test("初始排期写入：隔离 SQLite、事务权限、持久化及公开路由", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-schedule-create-"));
  const databasePath = join(fixture, "schedule.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-schedule-create-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const owner = await createOwnerAccount({ login: "schedule-create-one", name: "Synthetic first", password }, db);
  const other = await createOwnerAccount({ login: "schedule-create-two", name: "Synthetic second", password }, db);
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: owner.userId, role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: other.userId, role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const demands = ["one", "two", "demo-demand", " one "].map(id => ({ id, ownerId: id === "two" ? other.userId : owner.userId,
    description: "Synthetic demand", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000,
    renovationType: "repair", desiredDays: 10, status: "published" }));
  t.beforeEach(async () => {
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null, expiresAt: issued.expiresAt } });
    await db.schedule.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: demands });
  });
  const create = (value: unknown = input, credential = cookie, client: Database = db) => handleScheduleCreate(request(credential, value), client);
  const read = (id = "one", version?: number, credential = cookie) => handleScheduleRead(new Request(
    `${origin}/api/schedule?demandId=${encodeURIComponent(id)}${version ? `&version=${version}` : ""}`, { headers: { cookie: credential } }), second);

  await t.test("published/contracted 首版持久化，另一连接 GET 最新和 v1 一致且不改变需求状态", async () => {
    for (const [id, status] of [["one", "published"], [" one ", "contracted"]]) {
      await db.demandOrder.update({ where: { id }, data: { status } });
      const response = await create({ ...input, demandId: id });
      noCache(response); assert.equal(response.status, 201);
      const body = envelope(Schedule).parse(await response.json());
      assert.deepEqual(body, { ok: true, data: { demandId: id, version: 1, tasks: ScheduleCreateInput.parse(input).tasks.map(task => ({ ...task, responsibleProviderId: null, status: "pending" })) }, meta: { source: "live" } });
      for (const version of [undefined, 1]) { const result = await read(id, version); assert.equal(result.status, 200); assert.deepEqual(await result.json(), body); }
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id } })).status, status);
      await denied(await read(id, 2), 404, "SCHEDULE_NOT_FOUND");
    }
  });

  await t.test("先同源/身份预检，不消费未授权正文；拒绝未知查询参数", async () => {
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, "ai_home_demo_session=synthetic-provider"]) {
      const req = request(credential); await denied(await handleScheduleCreate(req, db), 401, "UNAUTHENTICATED"); assert.equal(req.bodyUsed, false);
    }
    const forbiddenHeaders: Record<string, string>[] = [{}, { origin: "https://other.example" }, { origin, "sec-fetch-site": "cross-site" }];
    for (const header of forbiddenHeaders) {
      const req = new Request(`${origin}/api/schedule`, { method: "POST", headers: { cookie, ...header }, body: "{}" });
      await denied(await handleScheduleCreate(req, db), 403, "FORBIDDEN"); assert.equal(req.bodyUsed, false);
    }
    await denied(await handleScheduleCreate(new Request(`${origin}/api/schedule?ownerId=one`, { method: "POST", headers: { origin, cookie } }), db), 400, "VALIDATION_ERROR");
    assert.equal(await db.schedule.count(), 0);
  });

  await t.test("过期/撤销/角色变化及双 cookie 都不能扩大写入权限", async () => {
    for (const data of [{ expiresAt: new Date(0) }, { expiresAt: issued.expiresAt, revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data });
      await denied(await create(input, `${cookie}; ai_home_demo_session=synthetic-provider`), 401, "UNAUTHENTICATED");
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } });
      await denied(await create(), 403, "FORBIDDEN");
    }
    assert.equal(await db.schedule.count(), 0);
  });

  await t.test("跨业主和不存在统一 404，演示/错误状态/已有任何版本不能写", async () => {
    const missing = await denied(await create({ ...input, demandId: "missing" }), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(await denied(await create({ ...input, demandId: "two" }), 404, "DEMAND_NOT_FOUND"), missing);
    await denied(await create(input, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await create({ ...input, demandId: "demo-demand" }), 409, "DEMO_DEMAND_READ_ONLY");
    for (const status of ["draft", "in_progress", "completed", "unknown"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } }); await denied(await create(), 409, "INVALID_STATE");
    }
    await db.demandOrder.update({ where: { id: "one" }, data: { status: "published" } });
    const existing = await db.schedule.create({ data: { demandId: "one", version: 7, tasksJson: "[]" } });
    await denied(await create(), 409, "SCHEDULE_ALREADY_EXISTS");
    assert.deepEqual(await db.schedule.findMany(), [existing]);
  });

  await t.test("坏 JSON、超大 UTF-8 正文和非法契约均为 400 且不写库", async () => {
    const invalid = new Request(`${origin}/api/schedule`, { method: "POST", headers: { origin, cookie }, body: "{" });
    await denied(await handleScheduleCreate(invalid, db), 400, "INVALID_JSON");
    for (const value of [{ ...input, ownerId: other.userId }, { ...input, tasks: [] }, { ...input, tasks: [{ ...input.tasks[0], status: "done" }] }, { ...input, huge: "测".repeat(23000) }]) {
      await denied(await create(value), 400, "VALIDATION_ERROR");
    }
    assert.equal(await db.schedule.count(), 0);
  });

  await t.test("写事务重验会话/当前角色和归属，拒绝并回滚注入的变化", async () => {
    const changes: [number, string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
      [401, "UNAUTHENTICATED", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })],
      [403, "FORBIDDEN", tx => tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } })],
      [404, "DEMAND_NOT_FOUND", tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } })],
    ];
    for (const [status, code, change] of changes) {
      let transactions = 0;
      const client = decorate(db, async tx => { if (++transactions === 2) await change(tx); return tx; });
      await denied(await create(input, cookie, client), status, code);
      assert.equal(transactions, 2); assert.equal(await db.schedule.count(), 0);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role, "owner");
      assert.equal((await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt, null);
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).ownerId, owner.userId);
    }
  });

  await t.test("最终嵌套写入仍限制归属/状态/空排期，读取后的变化不能创建", async () => {
    for (const change of [
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } }),
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { status: "completed" } }),
      (tx: Prisma.TransactionClient) => tx.schedule.create({ data: { demandId: "one", version: 2, tasksJson: "[]" } }),
    ]) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        update: async (args: Prisma.DemandOrderUpdateArgs) => { await change(tx); return tx.demandOrder.update(args); },
      } }) as unknown as Prisma.TransactionClient);
      await denied(await create(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE");
      assert.equal(await db.schedule.count(), 0);
      const row = await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } });
      assert.equal(row.ownerId, owner.userId); assert.equal(row.status, "published");
    }
  });

  await t.test("写入后 DTO 损坏、归属/版本/内容不符或存储异常均回滚且不泄漏细节", async () => {
    for (const change of [{ tasksJson: "{" }, { demandId: "two" }, { version: 2 }, { tasksJson: "[]" }]) {
      const client = decorate(db, async tx => ({ ...tx, schedule: { ...tx.schedule,
        findUniqueOrThrow: async (args: Prisma.ScheduleFindUniqueOrThrowArgs) => ({ ...await tx.schedule.findUniqueOrThrow(args), ...change }),
      } }) as unknown as Prisma.TransactionClient);
      await denied(await create(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE"); assert.equal(await db.schedule.count(), 0);
    }
    const client = { $transaction: () => { throw new Error("private database tokenHash"); } } as unknown as Database;
    await denied(await create(input, cookie, client), 503, "SCHEDULE_UNAVAILABLE");
  });

  await t.test("两连接同时创建最多一个 v1，重试不覆盖现有排期", async () => {
    const responses = await Promise.all([create(), create(input, cookie, second)]);
    assert.equal(responses.filter(response => response.status === 201).length, 1);
    for (const response of responses) assert.ok([201, 409, 503].includes(response.status));
    assert.equal(await db.schedule.count({ where: { demandId: "one" } }), 1);
    const saved = await db.schedule.findMany();
    await denied(await create(), 409, "SCHEDULE_ALREADY_EXISTS");
    assert.deepEqual(await db.schedule.findMany(), saved);
  });

  await t.test("公开密码登录 → 创建需求 → 创建排期 → 按版本读取；跨业主与退出写入拒绝", () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    const script = join(fixture, "public-create.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { POST as login, DELETE as logout } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { POST as demand } from ${modulePath("src/app/api/demand/route.ts")};
      import { POST, GET } from ${modulePath("src/app/api/schedule/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (path, method = 'GET', cookie = '', body) => new Request('${origin}' + path, { method,
        headers: { origin: '${origin}', cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        const signIn = async loginName => {
          const response = await login(req('/api/auth/owner', 'POST', '', { login: loginName, password: ${JSON.stringify(password)} }));
          assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
        };
        const cookie = await signIn('schedule-create-one');
        const created = await demand(req('/api/demand', 'POST', cookie, { description: 'Synthetic', city: 'Test', areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000, renovationType: 'repair', desiredDays: 10 }));
        assert.equal(created.status, 201); const id = (await created.json()).data.id;
        const input = { ...${JSON.stringify(input)}, demandId: id };
        assert.equal((await GET(req('/api/schedule?demandId=' + id, 'GET', cookie))).status, 404);
        const response = await POST(req('/api/schedule', 'POST', cookie, input));
        assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.meta.source, 'live');
        assert.deepEqual(await (await GET(req('/api/schedule?demandId=' + id + '&version=1', 'GET', cookie))).json(), saved);
        assert.equal((await POST(req('/api/schedule', 'POST', cookie, input))).status, 409);
        const foreign = await signIn('schedule-create-two');
        assert.equal((await POST(req('/api/schedule', 'POST', foreign, input))).status, 404);
        assert.equal((await GET(req('/api/schedule?demandId=' + id, 'GET', foreign))).status, 404);
        assert.equal((await logout(req('/api/auth/owner', 'DELETE', cookie))).status, 200);
        assert.equal((await POST(req('/api/schedule', 'POST', cookie, input))).status, 401);
        assert.equal(await prisma.schedule.count({ where: { demandId: id } }), 1);
        console.log('public-schedule-create-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-schedule-create-ok/);
  });
});
