import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, Quote, QuoteSubmissionInput, envelope } from "../src/contracts";

const origin = "http://localhost:3000";
const input = QuoteSubmissionInput.parse({ demandId: "b-demo-session-demand", estimatedDays: 5, items: [
  { code: "known", name: "合成测试费用", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "测试数据" },
  { code: "pending", name: "待确认", unit: "piece", quantity: 1, unitPriceCents: null, note: "" },
  { code: "zero", name: "零元", unit: "piece", quantity: 1, unitPriceCents: 0, note: "" },
] });
const request = (cookie = "", value: unknown = input, key = "b-demo-session-key-0001") => new Request(`${origin}/api/quote`, {
  method: "POST", headers: { origin, cookie, "Idempotency-Key": key, "content-type": "application/json" }, body: JSON.stringify(value),
});

test("默认报价 POST 使用真实演示 cookie 和隔离 SQLite，不注入身份", async t => {
  const previousUrl = process.env.DATABASE_URL;
  const previousFlag = process.env.DEMO_AUTH_ENABLED;
  const tempRoot = resolve(tmpdir());
  const fixtureDir = mkdtempSync(join(tempRoot, "ai-home-B-demo-quote-"));
  const databasePath = join(fixtureDir, "quote.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  let disconnect: (() => Promise<void>) | undefined;
  t.after(async () => {
    await disconnect?.();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousFlag === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousFlag;
    const target = resolve(fixtureDir);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-B-demo-quote-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DEMO_AUTH_ENABLED = "true";
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  // 本测试文件由 Node test runner 独立运行；先设置临时 URL，再加载默认 Prisma 单例及路由。
  const { prisma: db } = await import("../src/lib/prisma");
  disconnect = () => db.$disconnect();
  const { POST } = await import("../src/app/api/quote/route");
  const { handleQuoteSubmission } = await import("../src/lib/quote-engine/submit-request");
  const { createDemoSessionHandlers } = await import("../src/lib/demo-session-handlers");
  const loginApi = createDemoSessionHandlers(db);
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "合成服务方", city: "深圳", kind: "team", tagsJson: "[]" } });
  await db.user.createMany({ data: [
    { id: "b-demo-owner", name: "合成业主", role: "owner" },
    { id: DEMO_PROVIDER_USER_ID, name: "合成演示账号", role: "provider", providerId: DEMO_PROVIDER_ID },
  ] });
  await db.demandOrder.create({ data: { id: input.demandId, ownerId: "b-demo-owner", description: "合成需求", city: "深圳", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, status: "published" } });
  const login = async () => {
    const response = await loginApi.POST(new Request(`${origin}/api/auth/demo-provider`, {
      method: "POST", headers: { origin }, body: JSON.stringify({ action: "login_demo" }),
    }));
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  const failure = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, code);
    assert.equal("data" in body, false);
    assert.equal("meta" in body, false);
  };
  const counts = async () => [await db.quote.count(), await db.quoteSubmissionReceipt.count()];
  t.beforeEach(async () => {
    await db.quoteSubmissionReceipt.deleteMany();
    await db.quote.deleteMany();
    await db.demoProviderSession.deleteMany();
  });

  await t.test("首次 201/mock、断开重连后重放 200/mock，金额/null/零元与同一数据库记录一致", async () => {
    const cookie = await login();
    const first = await POST(request(cookie));
    assert.equal(first.status, 201);
    const body = envelope(Quote).parse(await first.json());
    assert.equal(body.meta.source, "mock");
    assert.equal(body.data.source, "mock");
    assert.equal(body.data.providerId, DEMO_PROVIDER_ID);
    assert.equal(body.data.knownTotalCents, 15);
    assert.deepEqual(body.data.items.map(row => row.amountCents), [15, null, 0]);
    assert.ok(body.data.pendingItems.length > 0);
    assert.equal(JSON.stringify(body).includes(cookie.split("=")[1]), false);
    await db.$disconnect();
    const replay = await POST(request(cookie));
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), body);
    assert.deepEqual(await counts(), [1, 1]);
    assert.equal((await db.quote.findUniqueOrThrow({ where: { id: body.data.id } })).source, "mock");
    assert.equal((await db.quote.findUniqueOrThrow({ where: { id: body.data.id } })).knownTotalCents, 15);
  });

  await t.test("无 cookie、伪造 cookie 或关闭演示时先拒绝，不消费请求体、不写库", async () => {
    const cookie = await login();
    for (const candidate of ["", "ai_home_demo_session=invalid", `ai_home_demo_session=${"f".repeat(64)}`]) {
      const req = request(candidate);
      await failure(await POST(req), 401, "UNAUTHENTICATED");
      assert.equal(req.bodyUsed, false);
    }
    process.env.DEMO_AUTH_ENABLED = "false";
    try {
      const req = request(cookie);
      await failure(await POST(req), 401, "UNAUTHENTICATED");
      assert.equal(req.bodyUsed, false);
    } finally { process.env.DEMO_AUTH_ENABLED = "true"; }
    assert.deepEqual(await counts(), [0, 0]);
  });

  await t.test("有效 cookie 也不能绕过同源检查或由输入指定 live 来源", async () => {
    const cookie = await login();
    for (const value of [null, "https://other.example"]) {
      const req = request(cookie);
      if (value === null) req.headers.delete("origin");
      else req.headers.set("origin", value);
      await failure(await POST(req), 401, "UNAUTHENTICATED");
      assert.equal(req.bodyUsed, false);
    }
    for (const extra of [{ source: "live" }, { meta: { source: "live" } }, { providerId: "provider-b" }]) {
      await failure(await POST(request(cookie, { ...input, ...extra })), 400, "VALIDATION_ERROR");
    }
    assert.deepEqual(await counts(), [0, 0]);
  });

  await t.test("过期、退出和账号解绑拒绝新提交及重放，原报价保留", async () => {
    for (const change of ["expire", "logout", "unbind"]) {
      const cookie = await login();
      const key = `b-demo-session-${change}-key`;
      assert.equal((await POST(request(cookie, input, key))).status, 201);
      const before = await counts();
      if (change === "expire") await db.demoProviderSession.updateMany({ data: { expiresAt: new Date(0) } });
      if (change === "logout") {
        assert.equal((await loginApi.DELETE(new Request(`${origin}/api/auth/demo-provider`, { method: "DELETE", headers: { origin, cookie } }))).status, 200);
      }
      if (change === "unbind") await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { providerId: null } });
      try {
        await failure(await POST(request(cookie, input, key)), 401, "UNAUTHENTICATED");
        await failure(await POST(request(cookie, input, `${key}-new`)), 401, "UNAUTHENTICATED");
        assert.deepEqual(await counts(), before);
      } finally {
        await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { providerId: DEMO_PROVIDER_ID } });
      }
    }
  });

  await t.test("预检后会话撤销或角色改变，默认事务 reader 重新验证并拒绝写入", async () => {
    for (const change of ["revoke", "role"]) {
      const cookie = await login();
      const req = request(cookie);
      req.json = async () => {
        if (change === "revoke") await db.demoProviderSession.deleteMany();
        else await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "owner" } });
        return input;
      };
      try {
        await failure(await POST(req), 401, "UNAUTHENTICATED");
        assert.deepEqual(await counts(), [0, 0]);
      } finally { await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider" } }); }
    }
  });

  await t.test("默认 reader 使用内核传入的 tx，可见事务内撤销；拒绝后整个事务回滚", async () => {
    const cookie = await login();
    const wrappedDb = { $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
      db.$transaction(async tx => {
        await tx.demoProviderSession.deleteMany();
        return work(tx);
      }, options),
    } as unknown as Pick<PrismaClient, "$transaction">;
    await failure(await handleQuoteSubmission(request(cookie), undefined, wrappedDb), 401, "UNAUTHENTICATED");
    assert.deepEqual(await counts(), [0, 0]);
    assert.equal(await db.demoProviderSession.count(), 1);
    assert.equal((await POST(request(cookie))).status, 201);
  });
});
