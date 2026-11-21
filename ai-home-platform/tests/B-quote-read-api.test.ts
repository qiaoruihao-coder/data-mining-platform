import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, Quote, QuoteSubmissionInput, envelope } from "../src/contracts";

const origin = "https://owner.example.test";
const request = (query = "", cookie = "") => new Request(`${origin}/api/quote${query}`, { headers: { cookie, origin } });
const forDemand = (id: string, cookie = "") => request(`?${new URLSearchParams({ demandId: id })}`, cookie);
const privateResponse = (response: Response) => {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
};
async function failure(response: Response, status: number, code: string) {
  privateResponse(response);
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.equal("data" in body, false);
  assert.equal("meta" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private-secret/);
  return body;
}

test("公开报价 GET 在隔离 SQLite 中验证实际会话读取和业主授权；签发身份仅为测试夹具", async t => {
  const previousUrl = process.env.DATABASE_URL;
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-B-read-api-"));
  const databasePath = join(fixture, "read.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  let disconnect: (() => Promise<void>) | undefined;
  t.after(async () => {
    await disconnect?.();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED; else process.env.DEMO_AUTH_ENABLED = previousDemo;
    const target = resolve(fixture);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-B-read-api-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DEMO_AUTH_ENABLED = "true";
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  // 先设置临时数据库再动态加载单例；默认公开 GET 不注入授权或身份。
  const { prisma: db } = await import("../src/lib/prisma");
  disconnect = () => db.$disconnect();
  const { GET, dynamic } = await import("../src/app/api/quote/route");
  const { handleQuoteRead } = await import("../src/lib/quote-engine/read-request");
  const { QuoteReadDenied } = await import("../src/lib/quote-engine/read");
  const { createQuoteAtomically } = await import("../src/lib/quote-engine/transaction");
  // D 内部签发仅在本测试中为合成账户准备凭证；业务实现只导入 server-auth。
  const { issueOwnerSession, revokeOwnerSession, OWNER_SESSION_COOKIE } = await import("../src/lib/owner-auth");
  const { issueDemoSession, DEMO_SESSION_COOKIE } = await import("../src/lib/demo-provider-session");
  assert.equal(dynamic, "force-dynamic");
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" } });
  await db.user.createMany({ data: [
    { id: "owner-one", name: "Synthetic owner", role: "owner" },
    { id: "owner-two", name: "Synthetic other", role: "owner" },
    { id: DEMO_PROVIDER_USER_ID, name: "Synthetic demo provider", role: "provider", providerId: DEMO_PROVIDER_ID },
  ] });
  const base = { ownerId: "owner-one", description: "Synthetic demand", city: "Test", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, status: "published" };
  const exactId = " 需求/a?b#c%20 ";
  await db.demandOrder.createMany({ data: [
    { ...base, id: "owned" }, { ...base, id: "other", ownerId: "owner-two" },
    ...["empty", "demo-demand", exactId].map(id => ({ ...base, id })),
  ] });
  const issue = async (userId = "owner-one", now = new Date()) => (await db.$transaction(tx =>
    issueOwnerSession({ userId, role: "owner", providerId: null }, tx, now))).cookie.split(";")[0];
  const cookie = await issue();
  const input = QuoteSubmissionInput.parse({ demandId: "owned", estimatedDays: 5, items: [
    { code: "paid", name: "Synthetic paid", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "" },
    { code: "unknown", name: "Synthetic unknown", unit: "job", quantity: 1, unitPriceCents: null, note: "" },
    { code: "zero", name: "Synthetic zero", unit: "job", quantity: 1, unitPriceCents: 0, note: "" },
  ] });
  const provider = { userId: DEMO_PROVIDER_USER_ID, role: "provider" as const, providerId: DEMO_PROVIDER_ID };
  const saved = await createQuoteAtomically(new Request(`${origin}/api/quote`, { method: "POST", headers: { "Idempotency-Key": "b-read-api-write-key" } }), input, provider, async () => provider, db);
  const row = await db.quote.findUniqueOrThrow({ where: { id: saved.quote.id } });
  await db.quote.createMany({ data: [
    { ...row, id: "a-accepted", status: "accepted" },
    { ...row, id: "draft", status: "draft", itemsJson: "{" },
    { ...row, id: "rejected", status: "rejected" },
    { ...row, id: "other-quote", demandId: "other" },
  ] });

  await t.test("无参数保留 mock 且不连接数据库；非法参数优先 400，不回退演示", async () => {
    let transactions = 0;
    const unavailable = { $transaction: async () => { transactions++; throw new Error("private-secret"); } } as unknown as Pick<PrismaClient, "$transaction">;
    const demo = await handleQuoteRead(request(), unavailable);
    privateResponse(demo);
    const body = envelope(Quote.array()).parse(await demo.json());
    assert.equal(body.meta.source, "mock");
    assert.ok(body.data.length > 0 && body.data.every(q => q.demandId === "demo-demand"));
    for (const query of ["?demandId=", "?demandId=%20", "?demandId=a&demandId=a", "?demandId=a&demandId=b", "?ownerId=owner-one", "?demandId=owned&source=live", "?DemandId=owned"]) {
      await failure(await handleQuoteRead(request(query, cookie), unavailable), 400, "VALIDATION_ERROR");
      await failure(await GET(request(query)), 400, "VALIDATION_ERROR");
    }
    assert.equal(transactions, 0);
  });

  await t.test("未登录和自报身份 401；当前角色为服务方/管理员以及演示服务方均 403", async () => {
    for (const invalid of ["", `${OWNER_SESSION_COOKIE}=owner-one`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`, `${cookie}; ${cookie}`]) {
      const req = forDemand("owned", invalid);
      req.headers.set("x-user-id", "owner-one"); req.headers.set("x-role", "owner");
      await failure(await GET(req), 401, "UNAUTHENTICATED");
    }
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: "owner-one" }, data: { role } });
      try { await failure(await GET(forDemand("missing", cookie)), 403, "FORBIDDEN"); }
      finally { await db.user.update({ where: { id: "owner-one" }, data: { role: "owner" } }); }
    }
    const demo = await issueDemoSession(new Request(`${origin}/api/auth/demo-provider`, { method: "POST", headers: { origin } }), db);
    await failure(await GET(forDemand("owned", `${DEMO_SESSION_COOKIE}=${demo.token}`)), 403, "FORBIDDEN");
  });

  await t.test("他人和不存在统一 404；精确 ID 不 trim；存在的空需求返回空成功", async () => {
    const other = await failure(await GET(forDemand("other", cookie)), 404, "DEMAND_NOT_FOUND");
    const absent = await failure(await GET(forDemand("absent", cookie)), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(other, absent);
    for (const id of ["empty", exactId, "demo-demand"]) {
      const response = await GET(forDemand(id, cookie));
      privateResponse(response);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, data: [], meta: { source: id === "demo-demand" ? "mock" : "live" } });
    }
    await failure(await GET(forDemand(exactId.trim(), cookie)), 404, "DEMAND_NOT_FOUND");
    const otherCookie = await issue("owner-two");
    const response = await GET(forDemand("other", otherCookie));
    assert.deepEqual((await response.json()).data.map((q: { id: string }) => q.id), ["other-quote"]);
    await failure(await GET(forDemand("owned", otherCookie)), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("原子写后重连由公开 GET 读取相同 ID/金额/null，所有需求状态只返回 submitted/accepted", async () => {
    await db.$disconnect();
    for (const status of ["draft", "published", "contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: "owned" }, data: { status } });
      const response = await GET(forDemand("owned", cookie));
      privateResponse(response);
      assert.equal(response.status, 200);
      const body = envelope(Quote.array()).parse(await response.json());
      assert.deepEqual(body.data.map(q => q.id), ["a-accepted", saved.quote.id]);
      assert.deepEqual(body.data[1], saved.quote);
      assert.deepEqual(body.data[1].items.map(item => item.amountCents), [15, null, 0]);
      assert.equal(body.meta.source, "mock");
      assert.ok(body.data.every(quote => quote.source === "mock"));
      assert.ok(!JSON.stringify(body).includes(cookie.split("=")[1]));
    }
  });

  await t.test("会话过期、撤销和归属变化立即影响下一次 GET，不复用缓存", async () => {
    const expired = await issue("owner-one", new Date(0));
    await failure(await GET(forDemand("owned", expired)), 401, "UNAUTHENTICATED");
    const revoked = await issue();
    assert.equal((await GET(forDemand("owned", revoked))).status, 200);
    await db.$transaction(tx => revokeOwnerSession(request("", revoked), tx));
    await failure(await GET(forDemand("owned", revoked)), 401, "UNAUTHENTICATED");
    await db.demandOrder.update({ where: { id: "owned" }, data: { ownerId: "owner-two" } });
    try { await failure(await GET(forDemand("owned", cookie)), 404, "DEMAND_NOT_FOUND"); }
    finally { await db.demandOrder.update({ where: { id: "owned" }, data: { ownerId: "owner-one" } }); }
  });

  await t.test("事务内撤销在默认授权器可见，拒绝先于报价读取并回滚", async () => {
    let reads = 0;
    const observed = db.$extends({ query: { quote: { async findMany({ args, query }) { reads++; return query(args); } } } });
    const wrapped = { $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
      observed.$transaction(async tx => {
        const transaction = tx as unknown as Prisma.TransactionClient;
        await revokeOwnerSession(request("", cookie), transaction);
        return work(transaction);
      }, options),
    } as unknown as Pick<PrismaClient, "$transaction">;
    await failure(await handleQuoteRead(forDemand("owned", cookie), wrapped), 401, "UNAUTHENTICATED");
    assert.equal(reads, 0);
    assert.equal((await GET(forDemand("owned", cookie))).status, 200);
  });

  await t.test("列表来源仅汇总返回报价，保留逐条来源；全 live、混合、演示需求及空列表遵循协议", async () => {
    // 明确 live 仅为数据库合成夹具，不代表已提供生产认证。
    await db.quote.updateMany({ where: { demandId: "owned", status: { in: ["submitted", "accepted"] } }, data: { source: "live" } });
    // 被过滤的损坏来源不得影响可见列表。
    await db.quote.update({ where: { id: "draft" }, data: { source: "invalid-hidden" } });
    try {
      const allLive = await GET(forDemand("owned", cookie));
      privateResponse(allLive);
      const liveBody = envelope(Quote.array()).parse(await allLive.json());
      assert.equal(liveBody.meta.source, "live");
      assert.ok(liveBody.data.every(quote => quote.source === "live"));
      await db.quote.update({ where: { id: row.id }, data: { source: "mock" } });
      const mixed = envelope(Quote.array()).parse(await (await GET(forDemand("owned", cookie))).json());
      assert.equal(mixed.meta.source, "mock");
      assert.deepEqual(mixed.data.map(quote => quote.source), ["live", "mock"]);
      await db.quote.create({ data: { ...row, id: "demo-live-fixture", demandId: "demo-demand", source: "live" } });
      const demo = envelope(Quote.array()).parse(await (await GET(forDemand("demo-demand", cookie))).json());
      assert.equal(demo.meta.source, "mock");
      assert.equal(demo.data[0].source, "live");
    } finally {
      await db.quote.updateMany({ where: { demandId: "owned" }, data: { source: "mock" } });
      await db.quote.deleteMany({ where: { id: "demo-live-fixture" } });
    }
  });

  await t.test("坏 JSON/DTO/溢出和非法库来源导致整批 503，绝不返回部分报价或 mock", async () => {
    for (const corrupt of [
      { itemsJson: "{" }, { pendingItemsJson: "{}" },
      ...["", "LIVE", "invalid-source"].map(source => ({ source })),
      { itemsJson: JSON.stringify([{ ...saved.quote.items[0], amountCents: -1 }]) },
      { itemsJson: JSON.stringify([{ ...saved.quote.items[0], amountCents: Number.MAX_SAFE_INTEGER }, { ...saved.quote.items[0], amountCents: 1 }]) },
    ]) {
      await db.quote.update({ where: { id: row.id }, data: corrupt });
      try { await failure(await GET(forDemand("owned", cookie)), 503, "DATABASE_UNAVAILABLE"); }
      finally { await db.quote.update({ where: { id: row.id }, data: { itemsJson: row.itemsJson, pendingItemsJson: row.pendingItemsJson, source: row.source } }); }
    }
    for (const source of [undefined, null]) {
      const missingSource = db.$extends({ query: { quote: { async findMany({ args, query }) {
        return (await query(args)).map(quote => ({ ...quote, source })) as never;
      } } } });
      await failure(await handleQuoteRead(forDemand("owned", cookie), missingSource as unknown as Pick<PrismaClient, "$transaction">), 503, "DATABASE_UNAVAILABLE");
    }
  });

  await t.test("存储故障和越界行 503，读取时需求消失 404，内核拒绝映射 403", async () => {
    const fail = async () => { throw new Error("private-secret"); };
    const clients = [
      db.$extends({ query: { ownerSession: { findUnique: fail } } }),
      db.$extends({ query: { quote: { findMany: fail } } }),
      db.$extends({ query: { quote: { async findMany({ args, query }) { return (await query(args)).map(q => ({ ...q, demandId: "other" })); } } } }),
      { $transaction: fail },
    ];
    for (const client of clients) await failure(await handleQuoteRead(forDemand("owned", cookie), client as unknown as Pick<PrismaClient, "$transaction">), 503, "DATABASE_UNAVAILABLE");
    const missing = db.$extends({ query: { demandOrder: { async findUnique() { return null; } } } });
    await failure(await handleQuoteRead(forDemand("owned", cookie), missing as unknown as Pick<PrismaClient, "$transaction">), 404, "DEMAND_NOT_FOUND");
    const denied = { $transaction: async () => { throw new QuoteReadDenied(); } } as unknown as Pick<PrismaClient, "$transaction">;
    await failure(await handleQuoteRead(forDemand("owned", cookie), denied), 403, "FORBIDDEN");
  });
});
