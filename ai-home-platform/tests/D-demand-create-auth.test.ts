import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Demand, DemandInput, envelope, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID } from "../src/contracts";
import { handleDemandCreate } from "../src/lib/demand-create";
import { createOwnerAccount } from "../src/lib/owner-account";
import { issueOwnerSession, OWNER_SESSION_COOKIE, revokeOwnerSession } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const input = { description: " 合成验收：浴室防滑需求。 ", city: " 深圳 ", areaM2: 55.5,
  budgetMinCents: 100, budgetMaxCents: 400000, renovationType: "elderly", desiredDays: 15 };
const password = "Synthetic account password 42!";
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body = JSON.stringify(input)) => new Request(`${origin}/api/demand`, {
  method: "POST", headers: { origin, cookie }, body,
});
function noCache(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  noCache(response);
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /private database|secret|tokenHash/);
}

test("需求 POST：隔离 SQLite 验证当前业主归属及实际登录创建链路", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-demand-create-"));
  const databasePath = join(fixture, "demand.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-demand-create-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  const owner = await createOwnerAccount({ login: "synthetic-owner", name: "Synthetic owner", password }, db);
  const other = await createOwnerAccount({ login: "synthetic-other", name: "Synthetic other", password }, db);
  const identity = { userId: owner.userId, role: "owner" as const, providerId: null };
  const issued = await db.$transaction(tx => issueOwnerSession(identity, tx));
  const cookie = issued.cookie.split(";")[0];
  const tokenHash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const create = (req = request(cookie), client: Database = db) => handleDemandCreate(req, client);
  t.beforeEach(async () => {
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash }, data: { userId: owner.userId, revokedAt: null, expiresAt: issued.expiresAt } });
  });

  await t.test("创建归属实际业主、published/live，文本归一化，不创建 demo-owner", async () => {
    const req = request(cookie);
    req.headers.set("x-user-id", other.userId);
    req.headers.set("x-role", "admin");
    const response = await create(req);
    noCache(response);
    assert.equal(response.status, 201);
    const body = envelope(Demand).parse(await response.json());
    assert.deepEqual(body.data, { ...DemandInput.parse(input), id: body.data.id, status: "published", source: "live" });
    assert.equal(body.meta.source, "live");
    await db.$disconnect();
    assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: body.data.id } })).ownerId, owner.userId);
    assert.equal(await db.user.findUnique({ where: { id: "demo-owner" } }), null);
    assert.equal("ownerId" in body.data, false);
  });

  await t.test("同源与身份拒绝先于正文；伪造、重复、过期、撤销与非 owner 不可创建", async () => {
    const before = await db.demandOrder.count();
    for (const value of ["", "https://evil.test"]) {
      const req = request(cookie, "{");
      req.headers.set("origin", value);
      await denied(await create(req), 403, "FORBIDDEN");
      assert.equal(req.bodyUsed, false);
    }
    const crossSite = request(cookie);
    crossSite.headers.set("sec-fetch-site", "cross-site");
    await denied(await create(crossSite), 403, "FORBIDDEN");
    for (const value of ["", `${OWNER_SESSION_COOKIE}=forged`, `${cookie}; ${cookie}`, `ai_home_demo_session=${"0".repeat(64)}`]) {
      const req = request(value, "{");
      await denied(await create(req), 401, "UNAUTHENTICATED");
      assert.equal(req.bodyUsed, false);
    }
    await db.$transaction(tx => revokeOwnerSession(request(cookie), tx));
    await denied(await create(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { revokedAt: null, expiresAt: new Date(0) } });
    await denied(await create(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { expiresAt: issued.expiresAt } });
    for (const role of ["admin", "provider"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } });
      await denied(await create(), 403, "FORBIDDEN");
    }
    assert.equal(await db.demandOrder.count(), before);
  });

  await t.test("非法 JSON、预算及客户端身份/状态/来源字段均拒绝且不写入", async () => {
    const before = await db.demandOrder.count();
    await denied(await create(request(cookie, "{")), 400, "INVALID_JSON");
    for (const value of [null, {}, { ...input, budgetMinCents: 400001 }, { ...input, areaM2: 0 },
      ...["ownerId", "userId", "role", "id", "status", "source"].map(key => ({ ...input, [key]: "forged" }))]) {
      await denied(await create(request(cookie, JSON.stringify(value))), 400, "VALIDATION_ERROR");
    }
    assert.equal(await db.demandOrder.count(), before);
  });

  await t.test("正文读取不持有事务；预检后的撤销、角色与会话身份变化必须拒绝", async () => {
    for (const change of [
      { status: 401, code: "UNAUTHENTICATED", run: () => db.$transaction(tx => revokeOwnerSession(request(cookie), tx)) },
      { status: 403, code: "FORBIDDEN", run: () => db.user.update({ where: { id: owner.userId }, data: { role: "admin" } }) },
      { status: 403, code: "FORBIDDEN", run: () => db.ownerSession.update({ where: { tokenHash }, data: { userId: other.userId } }) },
    ]) {
      await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
      await db.ownerSession.update({ where: { tokenHash }, data: { userId: owner.userId, revokedAt: null } });
      const before = await db.demandOrder.count();
      const req = request(cookie);
      const json = req.json.bind(req);
      req.json = async () => { const body = await json(); await change.run(); return body; };
      await denied(await create(req), change.status, change.code);
      assert.equal(await db.demandOrder.count(), before);
    }
  });

  await t.test("写入后坏输出/异常回滚；认证/创建/事务故障中性 503", async () => {
    const fail = async () => { throw new Error("private database secret"); };
    const before = await db.demandOrder.count();
    for (const client of [
      db.$extends({ query: { ownerSession: { findUnique: fail } } }),
      db.$extends({ query: { user: { findUnique: fail } } }),
      db.$extends({ query: { demandOrder: { create: fail } } }),
      db.$extends({ query: { demandOrder: { async create({ args, query }) { const row = await query(args); return { ...row, areaM2: -1 }; } } } }),
      db.$extends({ query: { demandOrder: { async create({ args, query }) { await query(args); return fail(); } } } }),
      { $transaction: fail },
    ]) {
      await denied(await create(request(cookie), client as unknown as Database), 503, "DATABASE_UNAVAILABLE");
      assert.equal(await db.demandOrder.count(), before);
    }
  });

  await t.test("写事务内重新读取实际角色，无预检身份快照授权", async () => {
    let calls = 0;
    const before = await db.demandOrder.count();
    const client = { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) =>
      db.$transaction(async tx => {
        if (++calls === 2) await tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } });
        return run(tx);
      }, options) } as unknown as Database;
    await denied(await create(request(cookie), client), 403, "FORBIDDEN");
    assert.equal(await db.demandOrder.count(), before);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role, "owner");
  });

  await t.test("公开登录 → POST 需求 → PUT 修改 → 服务方报价 → 本人读取；另一业主不能操作", async () => {
    await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" } });
    await db.user.create({ data: { id: DEMO_PROVIDER_USER_ID, name: "Synthetic demo", role: "provider", providerId: DEMO_PROVIDER_ID } });
    const script = join(fixture, "public-create.ts");
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { POST as login } from ${modulePath("src/app/api/auth/owner/route.ts")};
      import { POST as create } from ${modulePath("src/app/api/demand/route.ts")};
      import { PUT } from ${modulePath("src/app/api/demand/[id]/route.ts")};
      import { GET as quotes, POST as submit } from ${modulePath("src/app/api/quote/route.ts")};
      import { POST as demoLogin } from ${modulePath("src/app/api/auth/demo-provider/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (method, path, cookie = '', body, extra = {}) => new Request('${origin}' + path, { method,
        headers: { origin: '${origin}', cookie, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        const signIn = async loginName => {
          const result = await login(req('POST', '/api/auth/owner', '', { login: loginName, password: ${JSON.stringify(password)} }));
          assert.equal(result.status, 200);
          return result.headers.get('set-cookie').split(';')[0];
        };
        const cookie = await signIn('synthetic-owner');
        const response = await create(req('POST', '/api/demand', cookie, ${JSON.stringify(input)}));
        assert.equal(response.status, 201);
        const body = await response.json();
        const id = body.data.id;
        assert.equal((await prisma.demandOrder.findUniqueOrThrow({ where: { id } })).ownerId, ${JSON.stringify(owner.userId)});
        const context = { params: { id } };
        const changed = { ...${JSON.stringify(input)}, city: '广州' };
        assert.equal((await PUT(req('PUT', '/api/demand/' + id, cookie, changed), context)).status, 200);
        const demo = await demoLogin(req('POST', '/api/auth/demo-provider', '', { action: 'login_demo' }));
        assert.equal(demo.status, 200);
        const demoCookie = demo.headers.get('set-cookie').split(';')[0];
        const quote = await submit(req('POST', '/api/quote', demoCookie, { demandId: id,
          items: [{ code: 'test', name: '合成施工', unit: 'job', quantity: 1, unitPriceCents: 100, note: '' }], estimatedDays: 2 },
          { 'Idempotency-Key': 'synthetic-create-flow-0001' }));
        assert.equal(quote.status, 201);
        const comparison = await quotes(req('GET', '/api/quote?demandId=' + id, cookie));
        assert.equal(comparison.status, 200);
        const result = await comparison.json();
        assert.equal(result.data.length, 1);
        assert.equal(result.data[0].demandId, id);
        assert.equal(result.meta.source, 'mock');
        const other = await signIn('synthetic-other');
        assert.equal((await PUT(req('PUT', '/api/demand/' + id, other, changed), context)).status, 404);
        assert.equal((await quotes(req('GET', '/api/quote?demandId=' + id, other))).status, 404);
        console.log('public-create-flow-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DEMO_AUTH_ENABLED: "true" }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-create-flow-ok/);
  });
});
