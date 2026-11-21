import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Schedule, envelope, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID } from "../src/contracts";
import { handleScheduleRead } from "../src/lib/schedule-read";
import { createOwnerAccount } from "../src/lib/owner-account";
import { DEMO_DEMAND_ID } from "../src/lib/demand";
import { schedule as demoSchedule } from "../src/lib/mock-data";
import { OWNER_SESSION_COOKIE, issueOwnerSession, revokeOwnerSession } from "../src/lib/owner-auth";
import { DEMO_SESSION_COOKIE, issueDemoSession } from "../src/lib/demo-provider-session";

const origin = "https://localhost:3000";
const password = "Synthetic-schedule-password-2026";
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", query = "?demandId=one", method = "GET") =>
  new Request(`${origin}/api/schedule${query}`, { method, headers: { origin, cookie } });
function privateResponse(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  privateResponse(response);
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false); assert.equal(body.error.code, code);
  assert.equal("data" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|tasksJson/);
  return body;
}
async function success(response: Response) {
  privateResponse(response); assert.equal(response.status, 200);
  return envelope(Schedule).parse(await response.json());
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(tx => run(transform(tx)), options);
  } } as unknown as Database;
}

test("排期读取：真实业主会话、隔离 SQLite 和公开登录路由", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-schedule-read-"));
  const databasePath = join(fixture, "schedule.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-schedule-read-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const first = await createOwnerAccount({ login: "schedule-owner-one", password, name: "Synthetic first" }, db);
  const other = await createOwnerAccount({ login: "schedule-owner-two", password, name: "Synthetic second" }, db);
  await db.user.create({ data: { id: "demo-owner", name: "Synthetic demo owner", role: "owner" } });
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" } });
  await db.user.create({ data: { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider account", role: "provider", providerId: DEMO_PROVIDER_ID } });
  const issue = (userId: string) => db.$transaction(tx => issueOwnerSession({ userId, role: "owner", providerId: null }, tx));
  const issued = await issue(first.userId);
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await issue(other.userId)).cookie.split(";")[0];
  const demoCookie = (await issue("demo-owner")).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  process.env.DEMO_AUTH_ENABLED = "true";
  const provider = await issueDemoSession(request("", "", "POST"), db);
  const providerCookie = `${DEMO_SESSION_COOKIE}=${provider.token}`;
  const exactId = " 需求/a?b#c%20 ";
  const tasks = [{ id: "inspect", name: "Synthetic inspection", startDay: 0, durationDays: 1, dependsOn: [], responsibleProviderId: null, status: "pending" }];
  const rows = ["one", "two", DEMO_DEMAND_ID, " demo-demand ", exactId, exactId.trim(), "empty"].map(id => ({
    id, ownerId: id === "two" || id === exactId.trim() ? other.userId : id === "demo-demand" ? "demo-owner" : first.userId,
    description: "Synthetic", city: "Test", areaM2: 10, budgetMinCents: 0, budgetMaxCents: 10000,
    renovationType: "repair", desiredDays: 5, status: "published",
  }));
  const schedules = rows.filter(row => row.id !== "empty").flatMap(row => [1, 3].map(version => ({
    id: `${row.id}-${version}`, demandId: row.id, version, tasksJson: JSON.stringify(tasks),
  })));
  t.beforeEach(async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    await db.user.update({ where: { id: first.userId }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null, expiresAt: issued.expiresAt } });
    await db.schedule.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: rows });
    await db.schedule.createMany({ data: schedules });
  });
  const read = (id = "one", value = cookie, version?: number, client: Database = db) =>
    handleScheduleRead(request(value, `?demandId=${encodeURIComponent(id)}${version === undefined ? "" : `&version=${version}`}`), client);

  await t.test("各业主仅可读取本人需求的最新或指定版本，公开需求不等于公开排期", async () => {
    for (const [id, value] of [["one", cookie], ["two", otherCookie]]) {
      for (const status of ["draft", "published", "contracted", "in_progress", "completed"]) {
        await db.demandOrder.update({ where: { id }, data: { status } });
        const latest = await success(await read(id, value));
        assert.deepEqual(latest, { ok: true, data: { demandId: id, version: 3, tasks }, meta: { source: "live" } });
        assert.equal((await success(await read(id, value, 1))).data.version, 1);
      }
    }
    const missing = await denied(await read("missing"), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(await denied(await read("two"), 404, "DEMAND_NOT_FOUND"), missing);
    await denied(await read("one", otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await read("empty"), 404, "SCHEDULE_NOT_FOUND");
    await denied(await read("one", cookie, 2), 404, "SCHEDULE_NOT_FOUND");
  });

  await t.test("固定种子排期公开且始终 mock，不读取数据库中的同 ID 排期", async () => {
    let calls = 0;
    const unavailable = { $transaction: () => { calls++; throw new Error("private database"); } } as unknown as Database;
    const expected = { ok: true, data: demoSchedule, meta: { source: "mock" } };
    for (const value of ["", providerCookie, `${DEMO_SESSION_COOKIE}=invalid`]) {
      for (const query of ["", `?demandId=${DEMO_DEMAND_ID}`, `?demandId=${DEMO_DEMAND_ID}&version=${demoSchedule.version}`]) {
        assert.deepEqual(await success(await handleScheduleRead(request(value, query), unavailable)), expected);
      }
      await denied(await read(DEMO_DEMAND_ID, value, 3, unavailable), 404, "SCHEDULE_NOT_FOUND");
    }
    assert.equal(calls, 0);
    const noBusinessRead = decorate(db, tx => ({ ...tx,
      demandOrder: { ...tx.demandOrder, findFirst: async () => { throw new Error("unexpected demand read"); } },
      schedule: { ...tx.schedule, findFirst: async () => { throw new Error("unexpected schedule read"); },
        findUnique: async () => { throw new Error("unexpected schedule version read"); } },
    }) as unknown as Prisma.TransactionClient);
    for (const value of [cookie, otherCookie, demoCookie, `${cookie}; ${providerCookie}`]) {
      assert.deepEqual(await success(await read(DEMO_DEMAND_ID, value, undefined, noBusinessRead)), expected);
      assert.deepEqual(await success(await read(DEMO_DEMAND_ID, value, 1, noBusinessRead)), expected);
      // The database fixture has version 3; the public exception serves only the fixed seed.
      await denied(await read(DEMO_DEMAND_ID, value, 3, noBusinessRead), 404, "SCHEDULE_NOT_FOUND");
    }
    await db.schedule.updateMany({ where: { demandId: DEMO_DEMAND_ID }, data: { tasksJson: "{" } });
    await db.demandOrder.update({ where: { id: DEMO_DEMAND_ID }, data: { ownerId: other.userId, status: "draft" } });
    assert.deepEqual(await success(await read(DEMO_DEMAND_ID, cookie)), expected);
  });

  await t.test("例外仅匹配固定 ID，已发布真实需求及相似 ID 仍需归属，精确 ID 不 trim", async () => {
    for (const id of ["one", "two", "missing", " demo-demand ", "DEMO-DEMAND", "demo-demand-other"]) {
      await denied(await read(id, ""), 401, "UNAUTHENTICATED");
      await denied(await read(id, providerCookie), 403, "FORBIDDEN");
    }
    const similar = await success(await read(" demo-demand "));
    assert.equal(similar.data.demandId, " demo-demand "); assert.equal(similar.meta.source, "live");
    await denied(await read(" demo-demand ", otherCookie), 404, "DEMAND_NOT_FOUND");
    assert.equal((await success(await read(exactId))).data.demandId, exactId);
    await denied(await read(exactId.trim()), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("演示入口仍拒绝无效、重复、过期、撤销业主 cookie，不回退匿名或服务方", async () => {
    const queries = ["", `?demandId=${DEMO_DEMAND_ID}`, `?demandId=${DEMO_DEMAND_ID}&version=1`, `?demandId=${DEMO_DEMAND_ID}&version=3`];
    const reject = async (value: string, status = 401, code = "UNAUTHENTICATED") => {
      for (const query of queries) await denied(await handleScheduleRead(request(value, query), db), status, code);
    };
    for (const value of [`${OWNER_SESSION_COOKIE}=`, `${OWNER_SESSION_COOKIE}=bad`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`,
      `${cookie}; ${cookie}`, `${OWNER_SESSION_COOKIE}=bad; ${providerCookie}`, `${cookie}; ${cookie}; ${providerCookie}`]) await reject(value);
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(0) } });
    await reject(`${cookie}; ${providerCookie}`);
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: issued.expiresAt } });
    await db.$transaction(tx => revokeOwnerSession(request(cookie), tx));
    await reject(cookie);
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    await db.user.update({ where: { id: first.userId }, data: { role: "admin" } });
    await reject(cookie, 403, "FORBIDDEN");
    const brokenSession = decorate(db, tx => ({ ...tx, ownerSession: { ...tx.ownerSession,
      findUnique: async () => { throw new Error("private database tokenHash"); },
    } }) as unknown as Prisma.TransactionClient);
    await denied(await read(DEMO_DEMAND_ID, cookie, undefined, brokenSession), 503, "SCHEDULE_UNAVAILABLE");
  });

  await t.test("非法/重复/未知/自报身份参数在任何数据库操作前拒绝", async () => {
    let calls = 0;
    const unavailable = { $transaction: () => { calls++; throw new Error("private database"); } } as unknown as Database;
    for (const query of ["?unknown=", "?ownerId=x", "?version=1", "?demandId=", "?demandId=%20%20", "?demandId=one&demandId=two",
      `?demandId=${DEMO_DEMAND_ID}&role=owner`, `?demandId=${DEMO_DEMAND_ID}&version=0`,
      `?demandId=${DEMO_DEMAND_ID}&demandId=one`, `?demandId=${DEMO_DEMAND_ID}&version=1&version=3`,
      "?demandId=one&role=owner", "?demandId=one&version=1&version=3", ...["", "0", "-1", "1.1", "1e2", "%2B1", "2147483648"].map(version => `?demandId=one&version=${version}`)]) {
      await denied(await handleScheduleRead(request(cookie, query), unavailable), 400, "VALIDATION_ERROR");
    }
    assert.equal(calls, 0);
    await denied(await handleScheduleRead(request(cookie, "", "POST"), unavailable), 403, "FORBIDDEN");
    assert.equal((await handleScheduleRead(request(cookie, "?demandId=one", "HEAD"), db)).status, 200);
  });

  await t.test("匿名、伪造、重复及失效 cookie 不读取需求或排期；双 cookie 不放宽权限", async () => {
    let reads = 0;
    const observed = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder, findFirst: async () => { reads++; throw new Error("unexpected demand read"); } } }) as unknown as Prisma.TransactionClient);
    for (const value of ["", `${OWNER_SESSION_COOKIE}=bad`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`, `${cookie}; ${cookie}`,
      `${OWNER_SESSION_COOKIE}=bad; ${providerCookie}`, `${cookie}; ${cookie}; ${providerCookie}`]) {
      await denied(await read("one", value, undefined, observed), 401, "UNAUTHENTICATED");
    }
    await denied(await read("one", providerCookie, undefined, observed), 403, "FORBIDDEN");
    const forged = request(); forged.headers.set("x-user-id", first.userId); forged.headers.set("x-role", "owner");
    await denied(await handleScheduleRead(forged, observed), 401, "UNAUTHENTICATED");
    assert.equal(reads, 0);
    assert.equal((await success(await read("one", `${cookie}; ${providerCookie}`))).meta.source, "live");
    await denied(await read("two", `${cookie}; ${providerCookie}`), 404, "DEMAND_NOT_FOUND");
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(0) } });
    await denied(await read(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: issued.expiresAt } });
    await db.$transaction(tx => revokeOwnerSession(request(cookie), tx));
    await denied(await read("one", `${cookie}; ${providerCookie}`), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    await db.user.update({ where: { id: first.userId }, data: { role: "admin" } });
    await denied(await read(), 403, "FORBIDDEN");
  });

  await t.test("鉴权、归属过滤和排期查询都使用事务客户端；拒绝越界或错版本结果", async () => {
    const observed = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
      findFirst: async (args: Prisma.DemandOrderFindFirstArgs) => { assert.deepEqual(args.where, { id: "one", ownerId: first.userId }); return tx.demandOrder.findFirst(args); },
    }, schedule: { ...tx.schedule,
      findFirst: async (args: Prisma.ScheduleFindFirstArgs) => { assert.deepEqual(args.where, { demandId: "one" }); assert.deepEqual(args.orderBy, { version: "desc" }); return tx.schedule.findFirst(args); },
      findUnique: async (args: Prisma.ScheduleFindUniqueArgs) => { assert.deepEqual(args.where, { demandId_version: { demandId: "one", version: 1 } }); return tx.schedule.findUnique(args); },
    } }) as unknown as Prisma.TransactionClient);
    await success(await read("one", cookie, undefined, observed)); await success(await read("one", cookie, 1, observed));
    for (const changed of [{ id: "two" }, { ownerId: other.userId }]) {
      const wrong = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder, findFirst: async () => ({ id: "one", ownerId: first.userId, ...changed }) } }) as unknown as Prisma.TransactionClient);
      await denied(await read("one", cookie, undefined, wrong), 503, "SCHEDULE_UNAVAILABLE");
    }
    for (const changed of [{ demandId: "two" }, { version: 3 }]) {
      const wrong = decorate(db, tx => ({ ...tx, schedule: { ...tx.schedule, findUnique: async () => ({ ...schedules[0], ...changed }) } }) as unknown as Prisma.TransactionClient);
      await denied(await read("one", cookie, 1, wrong), 503, "SCHEDULE_UNAVAILABLE");
    }
    const moved = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder, findFirst: async (args: Prisma.DemandOrderFindFirstArgs) => {
      await tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } }); return tx.demandOrder.findFirst(args);
    } } }) as unknown as Prisma.TransactionClient);
    await denied(await read("one", cookie, undefined, moved), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("坏 JSON/DTO 和数据库故障返回安全的 503，不回退固定演示", async () => {
    for (const data of [{ tasksJson: "{" }, { tasksJson: "{}" }, { tasksJson: JSON.stringify([{ ...tasks[0], durationDays: 0 }]) }, { version: 0 }]) {
      await db.schedule.update({ where: { id: "one-1" }, data });
      await db.schedule.deleteMany({ where: { id: "one-3" } });
      await denied(await read(), 503, "SCHEDULE_UNAVAILABLE");
      await db.schedule.update({ where: { id: "one-1" }, data: schedules[0] });
    }
    const fail = async () => { throw new Error("private database tokenHash tasksJson"); };
    for (const client of [
      { $transaction: fail },
      decorate(db, tx => ({ ...tx, ownerSession: { ...tx.ownerSession, findUnique: fail } }) as unknown as Prisma.TransactionClient),
      decorate(db, tx => ({ ...tx, user: { ...tx.user, findUnique: fail } }) as unknown as Prisma.TransactionClient),
      decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder, findFirst: fail } }) as unknown as Prisma.TransactionClient),
      decorate(db, tx => ({ ...tx, schedule: { ...tx.schedule, findFirst: fail, findUnique: fail } }) as unknown as Prisma.TransactionClient),
    ]) await denied(await read("one", cookie, undefined, client as Database), 503, "SCHEDULE_UNAVAILABLE");
    const failedProvider = decorate(db, tx => ({ ...tx, demoProviderSession: { ...tx.demoProviderSession, findUnique: fail } }) as unknown as Prisma.TransactionClient);
    await denied(await read("one", providerCookie, undefined, failedProvider), 503, "SCHEDULE_UNAVAILABLE");
  });

  await t.test("另一连接变更归属或撤销会话后，下一请求立即重验", async () => {
    await success(await read());
    await second.demandOrder.update({ where: { id: "one" }, data: { ownerId: other.userId } });
    await denied(await read(), 404, "DEMAND_NOT_FOUND");
    await second.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } });
    await denied(await read("empty"), 401, "UNAUTHENTICATED");
  });

  await t.test("默认公开 GET：真实密码登录、按版本读取、越权拒绝和退出失效；写入拒绝失效凭证", () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    const script = join(fixture, "public-schedule.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { GET, POST as write } from ${modulePath("src/app/api/schedule/route.ts")};
      import { POST as login, DELETE as logout } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { schedule } from ${modulePath("src/lib/mock-data.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (path, method = 'GET', cookie = '', body) => new Request('${origin}' + path, { method,
        headers: { origin: '${origin}', cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        for (const query of ['?demandId=demo-demand', '?demandId=demo-demand&version=1']) {
          const demo = await GET(req('/api/schedule' + query));
          assert.equal(demo.status, 200); assert.deepEqual(await demo.json(), { ok: true, data: schedule, meta: { source: 'mock' } });
          assert.equal((await GET(req('/api/schedule' + query, 'GET', '${OWNER_SESSION_COOKIE}=invalid'))).status, 401);
        }
        assert.equal((await GET(req('/api/schedule?demandId=demo-demand&version=3'))).status, 404);
        assert.equal((await GET(req('/api/schedule?demandId=one'))).status, 401);
        const loggedIn = await login(req('/api/auth/owner', 'POST', '', { login: 'schedule-owner-one', password: ${JSON.stringify(password)} }));
        assert.equal(loggedIn.status, 200);
        const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
        assert.equal((await GET(req('/api/schedule?demandId=demo-demand', 'GET', cookie))).status, 200);
        const latest = await GET(req('/api/schedule?demandId=one', 'GET', cookie));
        assert.equal(latest.status, 200); assert.equal(latest.headers.get('cache-control'), 'private, no-store');
        assert.equal((await latest.json()).data.version, 3);
        const old = await GET(req('/api/schedule?demandId=one&version=1', 'GET', cookie));
        assert.equal((await old.json()).data.version, 1);
        assert.equal((await GET(req('/api/schedule?demandId=two', 'GET', cookie))).status, 404);
        assert.equal((await logout(req('/api/auth/owner', 'DELETE', cookie))).status, 200);
        assert.equal((await GET(req('/api/schedule?demandId=one', 'GET', cookie))).status, 401);
        assert.equal((await GET(req('/api/schedule?demandId=demo-demand', 'GET', cookie))).status, 401);
        const denied = await write(req('/api/schedule', 'POST', cookie));
        assert.equal(denied.status, 401); assert.equal((await denied.json()).ok, false);
        console.log('public-schedule-read-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-schedule-read-ok/);
  });
});
