import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Quote, envelope, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID } from "../src/contracts";
import { handleProviderQuotes } from "../src/lib/provider-quotes";
import { DEMO_SESSION_COOKIE, issueDemoSession, revokeDemoSession } from "../src/lib/demo-provider-session";
import { issueOwnerSession } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const request = (cookie = "", query = "") => new Request(`${origin}/api/provider/quotes${query}`, { headers: { origin, cookie } });
type Database = Pick<PrismaClient, "$transaction">;
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
  assert.equal("data" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private database|secret|tokenHash/);
}

test("本人报价：实际演示会话、两个服务方数据和隔离 SQLite", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-provider-quotes-"));
  const databasePath = join(fixture, "quotes.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  process.env.DEMO_AUTH_ENABLED = "true";
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-provider-quotes-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  await db.serviceProvider.createMany({ data: [DEMO_PROVIDER_ID, "provider-b"].map(id => ({ id, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" })) });
  await db.user.createMany({ data: [
    { id: DEMO_PROVIDER_USER_ID, name: "Synthetic demo", role: "provider", providerId: DEMO_PROVIDER_ID },
    { id: "owner-test", name: "Synthetic owner", role: "owner" },
  ] });
  await db.demandOrder.create({ data: { id: "synthetic-demand", ownerId: "owner-test", description: "Synthetic", city: "Test", areaM2: 10,
    budgetMinCents: 100, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, status: "published" } });
  const originalQuotes = [DEMO_PROVIDER_ID, "provider-b"].flatMap(providerId => ["draft", "submitted", "accepted", "rejected"].map(status => ({
    id: `${providerId}-${status}`, providerId, demandId: "synthetic-demand", source: status === "accepted" ? "live" : "mock",
    itemsJson: JSON.stringify([{ code: "unknown", name: "待定项目", unit: "job", quantity: 1, unitPriceCents: null, amountCents: null, note: "待确认" }]),
    pendingItemsJson: '["待定项目"]', knownTotalCents: 0, estimatedDays: 1, status,
  })));
  const issued = await issueDemoSession(request(), db);
  const cookie = `${DEMO_SESSION_COOKIE}=${issued.token}`;
  const ownerCookie = (await db.$transaction(tx => issueOwnerSession({ userId: "owner-test", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const read = (req = request(cookie), client: Database = db) => handleProviderQuotes(req, client);
  t.beforeEach(async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await db.quote.deleteMany();
    await db.quote.createMany({ data: originalQuotes });
  });

  await t.test("只读当前绑定服务方四种报价状态，保留单条来源及 null 金额，不声明订单", async () => {
    const req = request(cookie);
    req.headers.set("x-provider-id", "provider-b");
    req.headers.set("x-role", "admin");
    const response = await read(req);
    noCache(response);
    assert.equal(response.status, 200);
    const body = envelope(Quote.array()).parse(await response.json());
    assert.equal(body.meta.source, "mock");
    assert.equal(body.data.length, 4);
    assert.deepEqual(body.data.map(quote => quote.id), originalQuotes.filter(quote => quote.providerId === DEMO_PROVIDER_ID).map(quote => quote.id).sort());
    for (const quote of body.data) {
      assert.equal(quote.providerId, DEMO_PROVIDER_ID);
      assert.equal(quote.source, quote.status === "accepted" ? "live" : "mock");
      assert.equal(quote.items[0].amountCents, null);
      assert.equal("ownerId" in quote, false);
      assert.equal("orderId" in quote, false);
    }
    assert.equal((await read(request(`${ownerCookie}; ${cookie}`))).status, 200);
  });

  await t.test("所有参数拒绝且不读库，不能由客户端选身份或隐藏无效参数", async () => {
    let calls = 0;
    const broken = { $transaction: async () => { calls++; throw new Error("private database"); } } as unknown as Database;
    for (const query of ["?providerId=provider-b", "?providerId=provider-a&providerId=provider-b", "?status=accepted", "?userId=owner-test", "?page=1", "?unknown="]) {
      await denied(await read(request(cookie, query), broken), 400, "VALIDATION_ERROR");
    }
    assert.equal(calls, 0);
  });

  await t.test("匿名/伪造/重复/过期/撤销/关闭演示为 401，只有业主凭证为 403，不读取报价", async () => {
    const expired = await issueDemoSession(request(), db, new Date(0));
    const revoked = await issueDemoSession(request(), db);
    await revokeDemoSession(request(`${DEMO_SESSION_COOKIE}=${revoked.token}`), db);
    let reads = 0;
    const observed = db.$extends({ query: { quote: { async findMany({ args, query }) { reads++; return query(args); } } } });
    for (const value of ["", `${DEMO_SESSION_COOKIE}=forged`, `${cookie}; ${cookie}`, `${DEMO_SESSION_COOKIE}=${expired.token}`, `${DEMO_SESSION_COOKIE}=${revoked.token}`]) {
      await denied(await read(request(value), observed as unknown as Database), 401, "UNAUTHENTICATED");
    }
    await denied(await read(request(ownerCookie), observed as unknown as Database), 403, "FORBIDDEN");
    process.env.DEMO_AUTH_ENABLED = "false";
    await denied(await read(request(cookie), observed as unknown as Database), 401, "UNAUTHENTICATED");
    assert.equal(reads, 0);
  });

  await t.test("事务内重新验证当前角色/绑定，不能读取先前身份的报价", async () => {
    for (const data of [{ role: "admin" }, { providerId: "provider-b" }, { providerId: null }]) {
      const client = { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) =>
        db.$transaction(async tx => { await tx.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data }); return run(tx); }, options) } as unknown as Database;
      await denied(await read(request(cookie), client), 401, "UNAUTHENTICATED");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: DEMO_PROVIDER_USER_ID } })).providerId, DEMO_PROVIDER_ID);
    }
  });

  await t.test("鉴权通过的空列表才成功，其他服务方记录不影响结果", async () => {
    await db.quote.deleteMany({ where: { providerId: DEMO_PROVIDER_ID } });
    const response = await read();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, data: [], meta: { source: "mock" } });
    assert.equal(await db.quote.count(), 4);
  });

  await t.test("坏来源/JSON/DTO、越界查询结果及存储故障均 503，不回退空或固定 mock", async () => {
    const id = `${DEMO_PROVIDER_ID}-accepted`;
    const original = originalQuotes.find(quote => quote.id === id)!;
    for (const data of [{ source: "unknown" }, { itemsJson: "{" }, { pendingItemsJson: "{}" }, { knownTotalCents: -1 }, { status: "unknown" }]) {
      await db.quote.update({ where: { id }, data });
      await denied(await read(), 503, "DATABASE_UNAVAILABLE");
      await db.quote.update({ where: { id }, data: original });
    }
    const fail = async () => { throw new Error("private database secret"); };
    for (const client of [
      db.$extends({ query: { demoProviderSession: { findUnique: fail } } }),
      db.$extends({ query: { quote: { findMany: fail } } }),
      db.$extends({ query: { quote: { async findMany({ args, query }) { const rows = await query(args); return rows.map(row => ({ ...row, providerId: "provider-b" })); } } } }),
      db.$extends({ query: { quote: { async findMany({ args, query }) { const rows = await query(args); return [...rows, rows[0]]; } } } }),
      { $transaction: fail },
    ]) await denied(await read(request(cookie), client as unknown as Database), 503, "DATABASE_UNAVAILABLE");
  });

  await t.test("公开接口以真实演示登录读取本人报价，退出后再次读取失败", async () => {
    const script = join(fixture, "public-provider-quotes.ts");
    const modulePath = (path: string) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { GET } from ${modulePath("src/app/api/provider/quotes/route.ts")};
      import { POST, DELETE } from ${modulePath("src/app/api/auth/demo-provider/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      const req = (method, cookie = '', body) => new Request('${origin}/api/provider/quotes', { method,
        headers: { origin: '${origin}', cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
      async function main() {
        const login = await POST(req('POST', '', { action: 'login_demo' }));
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const response = await GET(req('GET', cookie));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.length, 4);
        assert.ok(body.data.every(quote => quote.providerId === '${DEMO_PROVIDER_ID}'));
        assert.equal(body.meta.source, 'mock');
        assert.equal((await DELETE(req('DELETE', cookie))).status, 200);
        assert.equal((await GET(req('GET', cookie))).status, 401);
        console.log('provider-quotes-public-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DEMO_AUTH_ENABLED: "true" }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /provider-quotes-public-ok/);
  });
});
