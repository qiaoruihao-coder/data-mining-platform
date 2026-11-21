import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, DemoProviderSession, QuoteSubmissionInput, envelope } from "../src/contracts";
import { createDemoSessionHandlers } from "../src/lib/demo-session-handlers";
import { DEMO_SESSION_COOKIE, isSameOrigin, readDemoSession } from "../src/lib/demo-provider-session";
import { readDemoVerifiedSession, requireProviderIdentity } from "../src/lib/server-auth";
import { createQuoteAtomically, QuoteWriteRejected } from "../src/lib/quote-engine/transaction";

const origin = "http://localhost:3000";
function request(method = "GET", cookie = "", body?: unknown, requestOrigin: string | null = origin) {
  return new Request(`${origin}/api/auth/demo-provider`, {
    method, headers: { cookie, ...(requestOrigin === null ? {} : { origin: requestOrigin }), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const identity = { userId: DEMO_PROVIDER_USER_ID, role: "provider" as const, providerId: DEMO_PROVIDER_ID };

test("NextRequest 的 loopback 规范化不误拒绝同源，也不放宽主机、端口或协议限制", () => {
  const req = new NextRequest("http://127.0.0.1:3187/api/auth/demo-provider", {
    method: "POST", headers: { host: "127.0.0.1:3187", origin: "http://127.0.0.1:3187" },
  });
  assert.equal(new URL(req.url).hostname, "localhost");
  assert.equal(isSameOrigin(req), true);
  for (const invalid of ["http://localhost:3187", "http://127.0.0.1:3188", "https://127.0.0.1:3187", "https://evil.example", "null"]) {
    req.headers.set("origin", invalid);
    req.headers.set("x-forwarded-host", invalid.replace(/^https?:\/\//, ""));
    assert.equal(isSameOrigin(req), false);
  }
  req.headers.set("origin", "http://127.0.0.1:3187");
  req.headers.set("sec-fetch-site", "cross-site");
  assert.equal(isSameOrigin(req), false);
});

test("演示登录使用隔离 SQLite 验证 cookie、会话与报价事务，不访问开发数据库", async t => {
  const previousFlag = process.env.DEMO_AUTH_ENABLED;
  const tempRoot = resolve(tmpdir());
  const fixtureDir = mkdtempSync(join(tempRoot, "ai-home-D-session-"));
  const databasePath = join(fixtureDir, "session.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    if (previousFlag === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousFlag;
    await db.$disconnect();
    const target = resolve(fixtureDir);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-D-session-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], { env, stdio: "pipe", timeout: 30000 });
  const seed = () => execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"], { env, stdio: "pipe", timeout: 30000 });
  seed();
  const api = createDemoSessionHandlers(db);
  const login = async (previousCookie = "") => {
    const response = await api.POST(request("POST", previousCookie, { action: "login_demo" }));
    assert.equal(response.status, 200);
    return { response, cookie: response.headers.get("set-cookie")!.split(";")[0] };
  };

  await t.test("重复 seed 保留既有账号，并提供固定模拟服务方绑定", async () => {
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { name: "保留测试名称" } });
    seed();
    const user = await db.user.findUniqueOrThrow({ where: { id: DEMO_PROVIDER_USER_ID } });
    assert.equal(user.name, "保留测试名称");
    assert.equal(user.providerId, DEMO_PROVIDER_ID);
    assert.equal(user.role, "provider");
  });

  await t.test("默认关闭，无 cookie 或伪造角色不能获取会话", async () => {
    delete process.env.DEMO_AUTH_ENABLED;
    const response = await api.GET(request());
    assert.deepEqual(await response.json(), { ok: true, data: { status: "disabled", demo: true }, meta: { source: "mock" } });
    assert.equal((await api.POST(request("POST", "", { action: "login_demo" }))).status, 403);
    assert.equal(await readDemoVerifiedSession(request("POST", "", { providerId: DEMO_PROVIDER_ID, role: "provider" }), db), null);
    assert.equal(await db.demoProviderSession.count(), 0);
    process.env.DEMO_AUTH_ENABLED = "true";
    assert.equal((await api.GET(request()).then(r => r.json())).data.status, "signed_out");
  });

  await t.test("登录与退出拒绝跨站和缺少 Origin，不接受客户端指定账号", async () => {
    for (const requestOrigin of [null, "https://evil.example", "null"]) {
      assert.equal((await api.POST(request("POST", "", { action: "login_demo" }, requestOrigin))).status, 403);
      assert.equal((await api.DELETE(request("DELETE", "", undefined, requestOrigin))).status, 403);
    }
    const crossSite = request("POST", "", { action: "login_demo" });
    crossSite.headers.set("sec-fetch-site", "cross-site");
    assert.equal((await api.POST(crossSite)).status, 403);
    for (const body of [{}, { action: "login" }, { action: "login_demo", providerId: "provider-b" }, { action: "login_demo", userId: "admin", role: "admin" }]) {
      assert.equal((await api.POST(request("POST", "", body))).status, 400);
    }
    const badJson = new Request(`${origin}/api/auth/demo-provider`, { method: "POST", headers: { origin }, body: "{" });
    assert.equal((await api.POST(badJson)).status, 400);
    assert.equal(await db.demoProviderSession.count(), 0);
  });

  await t.test("登录仅返回 mock 来源，凭证仅在 HttpOnly cookie，数据库只存摘要", async () => {
    const { response, cookie } = await login();
    const cookieHeader = response.headers.get("set-cookie")!;
    for (const flag of [/HttpOnly/i, /SameSite=Strict/i, /Path=\//, /Max-Age=1800/]) assert.match(cookieHeader, flag);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = envelope(DemoProviderSession).parse(await response.json());
    assert.equal(payload.meta.source, "mock");
    assert.equal(payload.data.status, "signed_in");
    const token = cookie.slice(DEMO_SESSION_COOKIE.length + 1);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(payload).includes(token), false);
    const stored = await db.demoProviderSession.findUniqueOrThrow({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    assert.notEqual(stored.tokenHash, token);
    assert.equal(stored.userId, DEMO_PROVIDER_USER_ID);
    assert.deepEqual(await readDemoVerifiedSession(request("GET", cookie), db), identity);
    const verified = await requireProviderIdentity(request("POST", cookie), req => readDemoVerifiedSession(req, db));
    assert.deepEqual(verified, { ok: true, identity });
    const freshClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try { assert.deepEqual(await readDemoVerifiedSession(request("GET", cookie), freshClient), identity); }
    finally { await freshClient.$disconnect(); }
    const secureRequest = new Request("https://example.test/api/auth/demo-provider", { method: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify({ action: "login_demo" }) });
    assert.match((await api.POST(secureRequest)).headers.get("set-cookie")!, /Secure/);
  });

  await t.test("伪造、重复 cookie 和跨站写请求都不能复用身份", async () => {
    const { cookie } = await login();
    for (const invalid of [`${DEMO_SESSION_COOKIE}=provider-a`, `${DEMO_SESSION_COOKIE}=${"f".repeat(64)}`, `${cookie}; ${cookie}`]) {
      assert.equal(await readDemoVerifiedSession(request("GET", invalid), db), null);
    }
    assert.equal(await readDemoVerifiedSession(request("POST", cookie, {}, "https://evil.example"), db), null);
    assert.equal(await readDemoVerifiedSession(request("POST", cookie, {}, null), db), null);
  });

  await t.test("到期、禁用、角色变化和换绑后的会话被拒绝", async () => {
    const { cookie } = await login();
    const session = await readDemoSession(request("GET", cookie), db);
    assert.ok(session);
    assert.equal(await readDemoSession(request("GET", cookie), db, new Date(session.expiresAt)), null);
    process.env.DEMO_AUTH_ENABLED = "false";
    assert.equal(await readDemoVerifiedSession(request("GET", cookie), db), null);
    process.env.DEMO_AUTH_ENABLED = "true";
    for (const data of [{ role: "owner" }, { role: "provider", providerId: "provider-b" }, { providerId: null }]) {
      await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data });
      assert.equal(await readDemoVerifiedSession(request("GET", cookie), db), null);
      const denied = await api.POST(request("POST", cookie, { action: "login_demo" }));
      assert.equal(denied.status, 503);
      assert.equal(denied.headers.has("set-cookie"), false);
    }
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await db.demoProviderSession.updateMany({ data: { expiresAt: new Date(0) } });
    assert.equal((await api.GET(request("GET", cookie)).then(r => r.json())).data.status, "signed_out");
  });

  await t.test("重新登录轮换 cookie，退出后原 cookie 及重放都失效", async () => {
    const first = await login();
    const second = await login(first.cookie);
    assert.notEqual(first.cookie, second.cookie);
    assert.equal(await readDemoVerifiedSession(request("GET", first.cookie), db), null);
    const response = await api.DELETE(request("DELETE", second.cookie));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await response.json()).data.status, "signed_out");
    assert.equal(await readDemoVerifiedSession(request("GET", second.cookie), db), null);
    assert.equal((await api.DELETE(request("DELETE", second.cookie))).status, 200);
  });

  await t.test("数据库故障返回 503，不暴露异常或伪装登录/退出成功", async () => {
    const { cookie } = await login();
    const fail = async () => { throw new Error("private database detail"); };
    const unavailable = createDemoSessionHandlers({
      demoProviderSession: { findUnique: fail, deleteMany: fail }, $transaction: fail,
    } as unknown as PrismaClient);
    for (const response of [await unavailable.GET(request("GET", cookie)), await unavailable.POST(request("POST", "", { action: "login_demo" })), await unavailable.DELETE(request("DELETE", cookie))]) {
      assert.equal(response.status, 503);
      assert.equal(response.headers.has("set-cookie"), false);
      assert.equal((await response.text()).includes("private database detail"), false);
    }
  });

  const input = QuoteSubmissionInput.parse({ demandId: "session-test-demand", estimatedDays: 5,
    items: [{ code: "task", name: "合成报价项目", unit: "job", quantity: 1, unitPriceCents: 100, note: "测试" }] });
  await db.demandOrder.create({ data: { id: input.demandId, ownerId: "demo-owner", description: "合成需求", city: "深圳", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, status: "published" } });

  await t.test("实际 cookie 可用于报价原子内核；事务内撤销会话立即阻止重放并回滚", async () => {
    const { cookie } = await login();
    const req = request("POST", cookie, input);
    req.headers.set("Idempotency-Key", "d-session-quote-test-key");
    const result = await createQuoteAtomically(req, input, identity, readDemoVerifiedSession, db);
    assert.equal(result.replayed, false);
    assert.equal(result.quote.providerId, DEMO_PROVIDER_ID);
    const replay = await createQuoteAtomically(req, input, identity, readDemoVerifiedSession, db);
    assert.equal(replay.replayed, true);
    assert.equal(replay.quote.id, result.quote.id);
    await assert.rejects(createQuoteAtomically(req, input, identity, async (r, tx) => {
      await tx.demoProviderSession.deleteMany({ where: { userId: identity.userId } });
      return readDemoVerifiedSession(r, tx);
    }, db), error => error instanceof QuoteWriteRejected && error.status === 401);
    assert.deepEqual(await readDemoVerifiedSession(request("GET", cookie), db), identity);
    assert.equal(await db.quote.count({ where: { demandId: input.demandId } }), 1);
    await api.DELETE(request("DELETE", cookie));
    await assert.rejects(createQuoteAtomically(req, input, identity, readDemoVerifiedSession, db), error => error instanceof QuoteWriteRejected && error.status === 401);
  });

  await t.test("独立进程通过演示 cookie 首次报价 201/mock，重连后同键重放 200 且不重复写入", async () => {
    const { cookie } = await login();
    const script = join(fixtureDir, "default-session.ts");
    const modulePath = (file: string) => JSON.stringify(resolve(file).replaceAll("\\", "/"));
    writeFileSync(script, `
      import { POST } from ${modulePath("src/app/api/quote/route.ts")};
      import { prisma } from ${modulePath("src/lib/prisma.ts")};
      import { requireProviderIdentity } from ${modulePath("src/lib/server-auth.ts")};
      import { Quote, envelope } from ${modulePath("src/contracts/index.ts")};
      async function main() {
        const req = (cookie: string) => new Request('${origin}/api/quote', {
          method: 'POST', headers: { origin: '${origin}', cookie, 'Idempotency-Key': 'd-session-public-quote-key' }, body: ${JSON.stringify(JSON.stringify(input))},
        });
        const before = await prisma.quote.count();
        const receiptsBefore = await prisma.quoteSubmissionReceipt.count();
        const session = await requireProviderIdentity(req(process.env.TEST_SESSION_COOKIE!));
        const denied = await POST(req(''));
        const anonymousAdded = await prisma.quote.count() - before;
        const anonymousReceiptsAdded = await prisma.quoteSubmissionReceipt.count() - receiptsBefore;
        const loggedIn = await POST(req(process.env.TEST_SESSION_COOKIE!));
        const body = envelope(Quote).parse(await loggedIn.json());
        const added = await prisma.quote.count() - before;
        const receiptsAdded = await prisma.quoteSubmissionReceipt.count() - receiptsBefore;
        const storedReceipt = await prisma.quoteSubmissionReceipt.findUniqueOrThrow({
          where: { providerId_idempotencyKey: { providerId: body.data.providerId, idempotencyKey: 'd-session-public-quote-key' } },
        });
        await prisma.$disconnect();
        const replay = await POST(req(process.env.TEST_SESSION_COOKIE!));
        const replayBody = envelope(Quote).parse(await replay.json());
        console.log(JSON.stringify({ sessionValid: session.ok, providerId: session.ok ? session.identity.providerId : null,
          anonymous: denied.status, anonymousAdded, anonymousReceiptsAdded,
          withDemoCookie: loggedIn.status, ok: body.ok, source: body.meta.source, added, receiptsAdded,
          receiptMatchesQuote: storedReceipt.quoteId === body.data.id,
          replayStatus: replay.status, replayOk: replayBody.ok, replaySource: replayBody.meta.source,
          sameQuoteId: replayBody.data.id === body.data.id,
          sameQuote: JSON.stringify(replayBody.data) === JSON.stringify(body.data),
          afterReplayAdded: await prisma.quote.count() - before,
          afterReplayReceiptsAdded: await prisma.quoteSubmissionReceipt.count() - receiptsBefore }));
      }
      main().finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...env, DEMO_AUTH_ENABLED: "true", TEST_SESSION_COOKIE: cookie }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.deepEqual(JSON.parse(output), { sessionValid: true, providerId: DEMO_PROVIDER_ID,
      anonymous: 401, anonymousAdded: 0, anonymousReceiptsAdded: 0,
      withDemoCookie: 201, ok: true, source: "mock", added: 1, receiptsAdded: 1, receiptMatchesQuote: true,
      replayStatus: 200, replayOk: true, replaySource: "mock", sameQuoteId: true, sameQuote: true,
      afterReplayAdded: 1, afterReplayReceiptsAdded: 1 });
  });
});
