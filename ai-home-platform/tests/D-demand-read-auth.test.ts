import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Demand, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, envelope, type OwnerIdentityDTO } from "../src/contracts";
import { handleDemandDetail, handleDemandList } from "../src/lib/demand-read";
import { createOwnerAccount } from "../src/lib/owner-account";
import { issueOwnerSession, OWNER_SESSION_COOKIE, revokeOwnerSession } from "../src/lib/owner-auth";
import { DEMO_SESSION_COOKIE, issueDemoSession, revokeDemoSession } from "../src/lib/demo-provider-session";

const origin = "https://localhost:3000";
const password = "Synthetic read test password 42!";
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", query = "", method = "GET") => new Request(`${origin}/api/demand${query}`, {
  method, headers: { cookie, origin },
});
function privateResponse(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  privateResponse(response);
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|passwordHash/);
  return body;
}
async function listBody(response: Response) {
  privateResponse(response);
  assert.equal(response.status, 200);
  const raw = await response.json();
  for (const row of raw.data) assert.equal("ownerId" in row, false);
  return envelope(Demand.array()).parse(raw);
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(tx => run(transform(tx)), options);
  } } as unknown as Database;
}

test("需求 GET：隔离 SQLite、合成业主与实际持久化会话", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-demand-read-"));
  const databasePath = join(fixture, "read.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-demand-read-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const first = await createOwnerAccount({ login: "read-owner-one", password, name: "Synthetic first" }, db);
  const other = await createOwnerAccount({ login: "read-owner-two", password, name: "Synthetic second" }, db);
  await db.serviceProvider.createMany({ data: [DEMO_PROVIDER_ID, "provider-two"].map(id => ({ id, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" })) });
  await db.user.createMany({ data: [
    { id: "empty-owner", name: "Synthetic empty", role: "owner" },
    { id: "demo-owner", name: "Synthetic legacy demo", role: "owner" },
    { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider account", role: "provider", providerId: DEMO_PROVIDER_ID },
  ] });
  const identity = (userId: string): OwnerIdentityDTO => ({ userId, role: "owner", providerId: null });
  const issue = (userId: string) => db.$transaction(tx => issueOwnerSession(identity(userId), tx));
  const issued = await issue(first.userId);
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await issue(other.userId)).cookie.split(";")[0];
  const emptyCookie = (await issue("empty-owner")).cookie.split(";")[0];
  const demoOwnerCookie = (await issue("demo-owner")).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  process.env.DEMO_AUTH_ENABLED = "true";
  const provider = await issueDemoSession(request("", "", "POST"), db);
  const providerCookie = `${DEMO_SESSION_COOKIE}=${provider.token}`;
  const providerHash = createHash("sha256").update(provider.token).digest("hex");
  const exactId = " 需求/a?b#c%20 ";
  const statuses = ["draft", "published", "contracted", "in_progress", "completed"];
  const base = { description: "Synthetic demand", city: "Test", areaM2: 10, budgetMinCents: 0,
    budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, createdAt: new Date("2026-01-01T00:00:00Z") };
  const rows = [
    ...statuses.flatMap(status => [
      { ...base, id: `one-${status}`, ownerId: first.userId, status },
      { ...base, id: `two-${status}`, ownerId: other.userId, status },
    ]),
    { ...base, id: "demo-demand", ownerId: "demo-owner", status: "published" },
    { ...base, id: exactId, ownerId: first.userId, status: "draft" },
    { ...base, id: exactId.trim(), ownerId: other.userId, status: "draft" },
  ];
  t.beforeEach(async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    await db.user.update({ where: { id: first.userId }, data: { role: "owner" } });
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null, expiresAt: issued.expiresAt } });
    const providerData = { tokenHash: providerHash, userId: DEMO_PROVIDER_USER_ID, providerId: DEMO_PROVIDER_ID, expiresAt: new Date(provider.data.expiresAt) };
    await db.demoProviderSession.upsert({ where: { tokenHash: providerHash }, create: providerData, update: providerData });
    await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: rows });
  });
  const list = (value = cookie, client: Database = db) => handleDemandList(request(value), client);
  const detail = (id = "one-published", value = cookie, client: Database = db) => handleDemandDetail(request(value), id, client);

  await t.test("业主列表仅本人全部状态；详情可读他人 published，其余与不存在统一 404", async () => {
    for (const [userId, value] of [[first.userId, cookie], [other.userId, otherCookie]]) {
      const body = await listBody(await list(value));
      assert.deepEqual(body.data.map(row => row.id).sort(), rows.filter(row => row.ownerId === userId).map(row => row.id).sort());
      assert.equal(body.meta.source, "live");
      for (const row of body.data) {
        const response = await detail(row.id, value);
        privateResponse(response); assert.equal(response.status, 200);
        assert.deepEqual(envelope(Demand).parse(await response.json()).data, row);
      }
    }
    const missing = await denied(await detail("missing"), 404, "DEMAND_NOT_FOUND");
    for (const status of statuses.filter(status => status !== "published")) {
      assert.deepEqual(await denied(await detail(`two-${status}`), 404, "DEMAND_NOT_FOUND"), missing);
    }
    for (const id of ["two-published", "demo-demand"]) {
      const response = await detail(id); privateResponse(response); assert.equal(response.status, 200);
      const body = await response.json(); assert.equal(body.data.id, id); assert.equal("ownerId" in body.data, false);
    }
    assert.deepEqual((await db.demandOrder.findUniqueOrThrow({ where: { id: "demo-demand" } })).ownerId, "demo-owner");
  });

  await t.test("授权空列表为 live；演示数据及混合数据保留逐条 mock", async () => {
    assert.deepEqual(await listBody(await list(emptyCookie)), { ok: true, data: [], meta: { source: "live" } });
    await db.demandOrder.create({ data: { ...base, id: "legacy-live", ownerId: "demo-owner", status: "published" } });
    const mixed = await listBody(await list(demoOwnerCookie));
    assert.equal(mixed.meta.source, "mock");
    assert.deepEqual(mixed.data.map(row => [row.id, row.source]), [["demo-demand", "mock"], ["legacy-live", "live"]]);
    assert.equal((await (await detail("demo-demand", demoOwnerCookie)).json()).meta.source, "mock");
  });

  await t.test("服务方仅查询已发布需求，演示身份整体 mock，逐条来源保留", async () => {
    const body = await listBody(await list(providerCookie));
    assert.deepEqual(body.data.map(row => row.id), ["demo-demand", "one-published", "two-published"]);
    assert.equal(body.meta.source, "mock");
    for (const row of body.data) {
      const response = await detail(row.id, providerCookie);
      assert.equal(response.status, 200);
      const result = envelope(Demand).parse(await response.json());
      assert.equal(result.meta.source, "mock"); assert.equal(result.data.source, row.id === "demo-demand" ? "mock" : "live");
    }
    for (const status of statuses.filter(status => status !== "published")) await denied(await detail(`one-${status}`, providerCookie), 404, "DEMAND_NOT_FOUND");
    await db.demandOrder.updateMany({ data: { status: "draft" } });
    assert.deepEqual(await listBody(await list(providerCookie)), { ok: true, data: [], meta: { source: "mock" } });
  });

  await t.test("匿名无需服务方登录即可读 published，非公开与不存在统一 404，来源与隐私保留", async () => {
    process.env.DEMO_AUTH_ENABLED = "false";
    const publicRows = rows.filter(row => row.status === "published").map(row => row.id).sort();
    const body = await listBody(await list(""));
    assert.deepEqual(body.data.map(row => row.id), publicRows); assert.equal(body.meta.source, "mock");
    for (const id of publicRows) {
      const response = await detail(id, ""); privateResponse(response); assert.equal(response.status, 200);
      const raw = await response.json(); assert.equal("ownerId" in raw.data, false);
      assert.equal(raw.meta.source, id === "demo-demand" ? "mock" : "live");
    }
    const missing = await denied(await detail("missing", ""), 404, "DEMAND_NOT_FOUND");
    for (const row of rows.filter(row => row.status !== "published")) assert.deepEqual(await denied(await detail(row.id, ""), 404, "DEMAND_NOT_FOUND"), missing);
    const forged = request(); forged.headers.set("x-user-id", first.userId); forged.headers.set("x-role", "owner");
    assert.deepEqual((await listBody(await handleDemandList(forged, db))).data.map(row => row.id), publicRows);
    await db.demandOrder.update({ where: { id: "demo-demand" }, data: { status: "draft" } });
    assert.equal((await listBody(await list(""))).meta.source, "live");
    await db.demandOrder.updateMany({ data: { status: "draft" } });
    assert.deepEqual(await listBody(await list("")), { ok: true, data: [], meta: { source: "live" } });
  });

  await t.test("无效或重复业主凭证拒绝且不读取需求，不回退公开访问", async () => {
    const noDemandRead = decorate(db, tx => ({ ...tx, demandOrder: {
      ...tx.demandOrder, findMany: () => { assert.fail("anonymous demand read"); }, findFirst: () => { assert.fail("anonymous demand read"); },
    } }) as unknown as Prisma.TransactionClient);
    for (const value of [`${OWNER_SESSION_COOKIE}=forged`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`, `${cookie}; ${cookie}`]) {
      await denied(await list(value, noDemandRead), 401, "UNAUTHENTICATED");
      await denied(await detail("demo-demand", value, noDemandRead), 401, "UNAUTHENTICATED");
    }
  });

  await t.test("业主过期、撤销及当前角色变化立即生效", async () => {
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(0) } });
    await denied(await list(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: issued.expiresAt } });
    await db.$transaction(tx => revokeOwnerSession(request(cookie), tx));
    await denied(await detail(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    await db.user.update({ where: { id: first.userId }, data: { role: "admin" } });
    await denied(await list(), 403, "FORBIDDEN"); await denied(await detail(), 403, "FORBIDDEN");
  });

  await t.test("服务方关闭、过期、退出、重复及绑定变化仍可读公开需求，不能读非公开需求", async () => {
    const publicAccess = async (value = providerCookie) => {
      const body = await listBody(await list(value));
      assert.ok(body.data.every(row => row.status === "published"));
      const response = await detail("one-published", value);
      assert.equal(response.status, 200); assert.equal((await response.json()).meta.source, "live");
      await denied(await detail("one-draft", value), 404, "DEMAND_NOT_FOUND");
    };
    process.env.DEMO_AUTH_ENABLED = "false";
    await publicAccess();
    process.env.DEMO_AUTH_ENABLED = "true";
    await db.demoProviderSession.update({ where: { tokenHash: providerHash }, data: { expiresAt: new Date(0) } });
    await publicAccess();
    await db.demoProviderSession.update({ where: { tokenHash: providerHash }, data: { expiresAt: new Date(provider.data.expiresAt) } });
    for (const data of [{ role: "owner" }, { role: "provider", providerId: "provider-two" }]) {
      await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data });
      await publicAccess();
    }
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await publicAccess(`${providerCookie}; ${providerCookie}`);
    await revokeDemoSession(request(providerCookie), db);
    await publicAccess();
  });

  await t.test("双 cookie 优先业主，无效业主不能回退服务方获得跨业主需求", async () => {
    assert.deepEqual(await listBody(await list(`${cookie}; ${providerCookie}`)), await listBody(await list()));
    assert.equal((await detail("two-published", `${cookie}; ${providerCookie}`)).status, 200);
    await denied(await detail("two-draft", `${cookie}; ${providerCookie}`), 404, "DEMAND_NOT_FOUND");
    for (const ownerCookie of [`${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`]) await denied(await list(`${ownerCookie}; ${providerCookie}`), 401, "UNAUTHENTICATED");
    await db.$transaction(tx => revokeOwnerSession(request(cookie), tx));
    await denied(await list(`${cookie}; ${providerCookie}`), 401, "UNAUTHENTICATED");
  });

  await t.test("精确 ID 不 trim；未知/重复/身份参数拒绝，校验先于数据库", async () => {
    assert.equal((await (await detail(exactId)).json()).data.id, exactId);
    await denied(await detail(exactId.trim()), 404, "DEMAND_NOT_FOUND");
    const unavailable = { $transaction: () => { assert.fail("validation must run before database"); } } as unknown as Database;
    for (const id of ["", " \t "]) await denied(await handleDemandDetail(request(), id, unavailable), 400, "VALIDATION_ERROR");
    for (const query of ["?ownerId=other", "?providerId=provider-a", "?role=admin", "?status=published", "?page=1", "?demandId=a&demandId=b", "?unknown="]) {
      await denied(await handleDemandList(request(cookie, query), unavailable), 400, "VALIDATION_ERROR");
      await denied(await handleDemandDetail(request(cookie, query), "one-published", unavailable), 400, "VALIDATION_ERROR");
    }
    await denied(await handleDemandList(request(cookie, "", "POST"), unavailable), 403, "FORBIDDEN");
    assert.equal((await handleDemandDetail(request(cookie, "", "HEAD"), "one-published", db)).status, 200);
  });

  await t.test("SQL 已限制范围；不可信数据库越界结果或坏 DTO 返回 503", async () => {
    const original = await db.demandOrder.findUniqueOrThrow({ where: { id: "one-published" } });
    for (const changed of [{ ownerId: other.userId, status: "draft" }, { status: "unknown" }, { areaM2: -1 }, { budgetMinCents: -1 }]) {
      const corrupt = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        findMany: async (args: Prisma.DemandOrderFindManyArgs) => {
          assert.deepEqual(args.where, { ownerId: first.userId }); return [{ ...original, ...changed }];
        },
        findFirst: async (args: Prisma.DemandOrderFindFirstArgs) => {
          assert.deepEqual(args.where, { id: original.id, OR: [{ status: "published" }, { ownerId: first.userId }] }); return { ...original, ...changed };
        },
      } }) as unknown as Prisma.TransactionClient);
      await denied(await list(cookie, corrupt), 503, "DATABASE_UNAVAILABLE");
      await denied(await detail(original.id, cookie, corrupt), 503, "DATABASE_UNAVAILABLE");
    }
    const privateProvider = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
      findMany: async (args: Prisma.DemandOrderFindManyArgs) => { assert.deepEqual(args.where, { status: "published" }); return [{ ...original, status: "draft" }]; },
      findFirst: async () => ({ ...original, id: "wrong-id" }),
    } }) as unknown as Prisma.TransactionClient);
    await denied(await list(providerCookie, privateProvider), 503, "DATABASE_UNAVAILABLE");
    await denied(await detail(original.id, providerCookie, privateProvider), 503, "DATABASE_UNAVAILABLE");
    await denied(await list("", privateProvider), 503, "DATABASE_UNAVAILABLE");
    await denied(await detail(original.id, "", privateProvider), 503, "DATABASE_UNAVAILABLE");
  });

  await t.test("会话/账户/查询/事务故障返回 503，绝不伪装空列表或 mock 成功", async () => {
    const fail = async () => { throw new Error("private database tokenHash"); };
    for (const client of [
      { $transaction: fail },
      decorate(db, tx => ({ ...tx, ownerSession: { ...tx.ownerSession, findUnique: fail } }) as unknown as Prisma.TransactionClient),
      decorate(db, tx => ({ ...tx, user: { ...tx.user, findUnique: fail } }) as unknown as Prisma.TransactionClient),
      decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder, findMany: fail, findFirst: fail } }) as unknown as Prisma.TransactionClient),
    ]) {
      await denied(await list(cookie, client as Database), 503, "DATABASE_UNAVAILABLE");
      await denied(await detail("one-published", cookie, client as Database), 503, "DATABASE_UNAVAILABLE");
    }
    const brokenProvider = decorate(db, tx => ({ ...tx, demoProviderSession: { ...tx.demoProviderSession, findUnique: fail } }) as unknown as Prisma.TransactionClient);
    await denied(await list(providerCookie, brokenProvider), 503, "DATABASE_UNAVAILABLE");
  });

  await t.test("独立连接改变归属、状态或会话后，新请求重新核验，不复用身份/数据缓存", async () => {
    assert.equal((await detail()).status, 200);
    await second.demandOrder.update({ where: { id: "one-published" }, data: { ownerId: other.userId, status: "draft" } });
    await denied(await detail(), 404, "DEMAND_NOT_FOUND");
    await denied(await detail("one-published", providerCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await detail("one-published", ""), 404, "DEMAND_NOT_FOUND");
    assert.ok(!(await listBody(await list())).data.some(row => row.id === "one-published"));
    await second.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } });
    await denied(await list(), 401, "UNAUTHENTICATED");
  });

  await t.test("默认公开路由：匿名 published、真实登录本人列表、非公开隔离及退出后公开访问", () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    const script = join(fixture, "public-read.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { GET as list } from ${modulePath("src/app/api/demand/route.ts")};
      import { GET as detail } from ${modulePath("src/app/api/demand/[id]/route.ts")};
      import { POST as login, DELETE as logout } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { POST as providerLogin, DELETE as providerLogout } from ${modulePath("src/app/api/auth/demo-provider/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const origin = '${origin}';
      const request = (path, method = 'GET', cookie = '', body) => new Request(origin + path, {
        method, headers: { origin, cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const get = (id, cookie = '') => detail(request('/api/demand/' + encodeURIComponent(id), 'GET', cookie), { params: { id } });
      async function main() {
        const anonymous = await list(request('/api/demand'));
        assert.equal(anonymous.status, 200);
        const publicBody = await anonymous.json();
        assert.ok(publicBody.data.every(row => row.status === 'published' && !('ownerId' in row)));
        assert.ok(publicBody.data.some(row => row.id === 'demo-demand'));
        assert.equal((await get('demo-demand')).status, 200);
        assert.equal((await get('one-draft')).status, 404);
        const loggedIn = await login(request('/api/auth/owner', 'POST', '', { login: 'read-owner-one', password: ${JSON.stringify(password)} }));
        assert.equal(loggedIn.status, 200);
        const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
        const listed = await list(request('/api/demand', 'GET', cookie));
        assert.equal(listed.status, 200); assert.equal(listed.headers.get('cache-control'), 'private, no-store');
        assert.ok((await listed.json()).data.every(row => !row.id.startsWith('two-') && row.id !== 'demo-demand'));
        assert.equal((await get('one-draft', cookie)).status, 200);
        assert.equal((await get('two-published', cookie)).status, 200);
        assert.equal((await get('two-draft', cookie)).status, 404);
        const provider = await providerLogin(request('/api/auth/demo-provider', 'POST', '', { action: 'login_demo' }));
        assert.equal(provider.status, 200);
        const providerCookie = provider.headers.get('set-cookie').split(';')[0];
        const published = await list(request('/api/demand', 'GET', providerCookie));
        assert.equal(published.status, 200);
        const publishedBody = await published.json();
        assert.equal(publishedBody.meta.source, 'mock'); assert.ok(publishedBody.data.every(row => row.status === 'published'));
        assert.equal((await get('two-draft', providerCookie)).status, 404);
        assert.equal((await get('two-published', cookie + '; ' + providerCookie)).status, 200);
        assert.equal((await get('two-draft', cookie + '; ' + providerCookie)).status, 404);
        assert.equal((await logout(request('/api/auth/owner', 'DELETE', cookie))).status, 200);
        assert.equal((await get('one-published', cookie)).status, 401);
        assert.equal((await providerLogout(request('/api/auth/demo-provider', 'DELETE', providerCookie))).status, 200);
        assert.equal((await list(request('/api/demand', 'GET', providerCookie))).status, 200);
        assert.equal((await get('one-published')).status, 200);
        assert.equal((await get('one-draft')).status, 404);
        console.log('public-demand-read-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DEMO_AUTH_ENABLED: "true" }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-demand-read-ok/);
  });
});
