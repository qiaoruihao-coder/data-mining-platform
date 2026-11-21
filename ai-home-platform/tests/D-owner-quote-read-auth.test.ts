import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, OwnerIdentity, QuoteQuery, QuoteSubmissionInput, type OwnerIdentityDTO } from "../src/contracts";
import {
  authorizeOwnerQuoteRead, readOwnerVerifiedSession, parseQuoteQuery, OwnerAccessError, ownerAccessFailureResponse,
} from "../src/lib/server-auth";
import { issueOwnerSession, revokeOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";
import { issueDemoSession, DEMO_SESSION_COOKIE } from "../src/lib/demo-provider-session";
import { readStoredQuoteComparison } from "../src/lib/quote-engine/read";
import { createQuoteAtomically } from "../src/lib/quote-engine/transaction";

const origin = "https://owner.example.test";
const request = (cookie = "", method = "GET") => new Request(`${origin}/api/quote?demandId=owned-demand`, { method, headers: { cookie, origin } });
const owner: OwnerIdentityDTO = { userId: "owner-one", role: "owner", providerId: null };
function denied(code: OwnerAccessError["code"]) {
  return (error: unknown) => error instanceof OwnerAccessError && error.code === code;
}

test("QuoteQuery 使用精确 ID；重复、空白和未知参数不能降级到演示入口", () => {
  assert.equal(parseQuoteQuery(new URLSearchParams()), null);
  const exact = " 需求/a?b#c%20 ";
  assert.deepEqual(parseQuoteQuery(new URLSearchParams({ demandId: exact })), { demandId: exact });
  assert.deepEqual(QuoteQuery.parse({ demandId: exact }), { demandId: exact });
  for (const query of ["demandId=", "demandId=%20%20", "demandId=a&demandId=a", "demandId=a&demandId=b", "ownerId=x", "demandId=a&ownerId=x", "DemandId=a"]) {
    assert.throws(() => parseQuoteQuery(new URLSearchParams(query)), denied("VALIDATION_ERROR"));
  }
  assert.equal(QuoteQuery.safeParse({ demandId: "ok", ownerId: "other" }).success, false);
  assert.equal(OwnerIdentity.safeParse({ ...owner, role: "admin" }).success, false);
  assert.equal(OwnerIdentity.safeParse({ ...owner, providerId: "provider-a" }).success, false);
});

test("授权错误使用失败信封及禁止缓存头，不泄露数据库细节", async () => {
  for (const [code, status] of [["VALIDATION_ERROR", 400], ["UNAUTHENTICATED", 401], ["FORBIDDEN", 403], ["DEMAND_NOT_FOUND", 404], ["DATABASE_UNAVAILABLE", 503]] as const) {
    const response = ownerAccessFailureResponse(new OwnerAccessError(code));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.deepEqual(await response.json(), { ok: false, error: { code, message: new OwnerAccessError(code).message } });
  }
});

test("业主会话与 B 读取内核使用同一隔离 SQLite，签发前身份为合成测试夹具", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-owner-auth-"));
  const databasePath = join(fixture, "owner.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect();
    const target = resolve(fixture);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-D-owner-auth-"));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" } });
  await db.user.createMany({ data: [
    { id: owner.userId, name: "Synthetic owner", role: "owner" },
    { id: "owner-two", name: "Synthetic other owner", role: "owner" },
    { id: "admin", name: "Synthetic administrator", role: "admin" },
    { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider account", role: "provider", providerId: DEMO_PROVIDER_ID },
  ] });
  const demand = { id: "owned-demand", ownerId: owner.userId, description: "Synthetic demand", city: "Test", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5, status: "published" };
  const exactId = " 需求/a?b#c%20 ";
  await db.demandOrder.createMany({ data: [demand, { ...demand, id: "other-demand", ownerId: "owner-two" },
    { ...demand, id: "empty-demand" }, { ...demand, id: "demo-demand" }, { ...demand, id: exactId }] });
  const issue = (identity = owner) => db.$transaction(tx => issueOwnerSession(identity, tx));
  const issued = await issue();
  const cookie = issued.cookie.split(";")[0];
  const token = cookie.slice(OWNER_SESSION_COOKIE.length + 1);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const read = (req = request(cookie), id = demand.id, client: Pick<PrismaClient, "$transaction"> = db) => readStoredQuoteComparison(req, id, authorizeOwnerQuoteRead, client);

  await t.test("可信签发检查当前账户；cookie 随机且只存摘要，重连可读取", async () => {
    for (const flag of [/HttpOnly/, /Secure/, /SameSite=Strict/, /Path=\//, /Max-Age=1800/]) assert.match(issued.cookie, flag);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.notEqual((await issue()).cookie, issued.cookie);
    assert.equal(await db.ownerSession.findUnique({ where: { tokenHash: token } }), null);
    const stored = await db.ownerSession.findUniqueOrThrow({ where: { tokenHash } });
    assert.equal(stored.userId, owner.userId);
    assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 1800000);
    assert.equal(stored.revokedAt, null);
    for (const userId of ["missing", "admin", DEMO_PROVIDER_USER_ID]) {
      await assert.rejects(issue({ ...owner, userId }), denied("FORBIDDEN"));
    }
    await assert.rejects(issue({ ...owner, role: "admin" } as unknown as OwnerIdentityDTO), denied("FORBIDDEN"));
    await db.$disconnect();
    const fresh = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try { assert.deepEqual(await fresh.$transaction(tx => readOwnerVerifiedSession(request(cookie), tx)), owner); }
    finally { await fresh.$disconnect(); }
  });

  await t.test("伪造身份、缺失/未知/重复 cookie 先于需求及报价读取被拒绝", async () => {
    let businessReads = 0;
    const observed = db.$extends({ query: {
      demandOrder: { async findFirst({ args, query }) { businessReads++; return query(args); }, async findUnique({ args, query }) { businessReads++; return query(args); } },
      quote: { async findMany({ args, query }) { businessReads++; return query(args); } },
    } });
    for (const invalid of ["", `${OWNER_SESSION_COOKIE}=owner-one`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`, `${cookie}; ${cookie}`]) {
      const forged = request(invalid);
      forged.headers.set("x-user-id", owner.userId);
      forged.headers.set("x-role", "owner");
      await assert.rejects(read(forged, demand.id, observed as unknown as Pick<PrismaClient, "$transaction">), denied("UNAUTHENTICATED"));
    }
    assert.equal(businessReads, 0);
  });

  await t.test("本人所有需求状态均可读取；精确 ID、空列表和演示来源保持正确", async () => {
    for (const status of ["draft", "published", "contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: demand.id }, data: { status } });
      assert.equal((await read())?.demand.status, status);
    }
    await db.demandOrder.update({ where: { id: demand.id }, data: { status: "published" } });
    assert.deepEqual((await read(request(cookie), "empty-demand"))?.response, { ok: true, data: [], meta: { source: "live" } });
    assert.equal((await read(request(cookie), "demo-demand"))?.response.meta.source, "mock");
    assert.equal((await read(request(cookie), exactId))?.demand.id, exactId);
    await assert.rejects(read(request(cookie), exactId.trim()), denied("DEMAND_NOT_FOUND"));
  });

  await t.test("他人和不存在需求同为 404，SQL 使用当前 ownerId；自报身份不能扩大范围", async () => {
    let queryCount = 0;
    const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) {
      queryCount++;
      assert.equal(args.where?.ownerId, owner.userId);
      return query(args);
    } } } });
    const failures: unknown[] = [];
    for (const id of ["other-demand", "nonexistent"]) {
      const forged = new Request(`${origin}/api/quote?demandId=${id}&ownerId=owner-two`, { headers: { cookie, "x-user-id": "owner-two" } });
      try { await read(forged, id, observed as unknown as Pick<PrismaClient, "$transaction">); assert.fail("must deny"); }
      catch (error) { assert.ok(error instanceof OwnerAccessError); failures.push(await ownerAccessFailureResponse(error).json()); }
    }
    assert.equal(queryCount, 2);
    assert.deepEqual(failures[0], failures[1]);
    assert.equal((failures[0] as { error: { code: string } }).error.code, "DEMAND_NOT_FOUND");
  });

  await t.test("角色变化和有效演示服务方均拒绝 403，不能读取竞争者报价", async () => {
    let businessReads = 0;
    const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) { businessReads++; return query(args); } } } });
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } });
      await assert.rejects(read(request(cookie), demand.id, observed as unknown as Pick<PrismaClient, "$transaction">), denied("FORBIDDEN"));
    }
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    process.env.DEMO_AUTH_ENABLED = "true";
    const demo = await issueDemoSession(request("", "POST"), db);
    const demoCookie = `${DEMO_SESSION_COOKIE}=${demo.token}`;
    await assert.rejects(read(request(demoCookie), demand.id, observed as unknown as Pick<PrismaClient, "$transaction">), denied("FORBIDDEN"));
    await assert.rejects(read(request(`${demoCookie}; ${OWNER_SESSION_COOKIE}=invalid`)), denied("UNAUTHENTICATED"));
    assert.equal(businessReads, 0);
    assert.ok(await read(request(`${cookie}; ${demoCookie}`)));
    for (const method of ["POST", "PUT", "DELETE"]) await assert.rejects(read(request(cookie, method)), denied("FORBIDDEN"));
  });

  await t.test("过期、撤销及账户删除返回 401；失效后不能回退到固定业主", async () => {
    assert.equal(await db.$transaction(tx => readOwnerVerifiedSession(request(cookie), tx, issued.expiresAt)), null);
    const expired = await issue();
    const expiredCookie = expired.cookie.split(";")[0];
    const expiredHash = createHash("sha256").update(expiredCookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
    await db.ownerSession.update({ where: { tokenHash: expiredHash }, data: { expiresAt: new Date(0) } });
    await assert.rejects(read(request(expiredCookie)), denied("UNAUTHENTICATED"));
    const revoked = (await issue()).cookie.split(";")[0];
    await db.$transaction(tx => revokeOwnerSession(request(revoked), tx));
    await db.$transaction(tx => revokeOwnerSession(request(revoked), tx));
    await assert.rejects(read(request(revoked)), denied("UNAUTHENTICATED"));
    await db.user.create({ data: { id: "temporary-owner", name: "Synthetic temporary", role: "owner" } });
    const deleted = (await issue({ ...owner, userId: "temporary-owner" })).cookie.split(";")[0];
    await db.user.delete({ where: { id: "temporary-owner" } });
    assert.equal(await db.ownerSession.count({ where: { userId: "temporary-owner" } }), 0);
    await assert.rejects(read(request(deleted)), denied("UNAUTHENTICATED"));
  });

  await t.test("当前事务的撤销、换角色与换归属立即可见，拒绝先于报价查询且可回滚", async () => {
    let quoteReads = 0;
    const observed = db.$extends({ query: { quote: { async findMany({ args, query }) { quoteReads++; return query(args); } } } });
    const changes: Array<{ code: OwnerAccessError["code"]; apply: (tx: Prisma.TransactionClient) => Promise<unknown> }> = [
      { code: "UNAUTHENTICATED", apply: tx => revokeOwnerSession(request(cookie), tx) },
      { code: "FORBIDDEN", apply: tx => tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } }) },
      { code: "DEMAND_NOT_FOUND", apply: tx => tx.demandOrder.update({ where: { id: demand.id }, data: { ownerId: "owner-two" } }) },
    ];
    for (const change of changes) {
      await assert.rejects(readStoredQuoteComparison(request(cookie), demand.id, async (req, id, tx) => {
        assert.equal(await authorizeOwnerQuoteRead(req, id, tx), true);
        await change.apply(tx);
        return authorizeOwnerQuoteRead(req, id, tx);
      }, observed as unknown as Pick<PrismaClient, "$transaction">), denied(change.code));
      assert.deepEqual(await db.$transaction(tx => readOwnerVerifiedSession(request(cookie), tx)), owner);
      assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: demand.id } })).ownerId, owner.userId);
    }
    assert.equal(quoteReads, 0);
  });

  await t.test("会话、账户和归属查询故障都返回可分类 503，不泄露异常也不伪装匿名", async () => {
    const fail = async () => { throw new Error("private database connection details"); };
    const clients = [
      db.$extends({ query: { ownerSession: { findUnique: fail } } }),
      db.$extends({ query: { user: { findUnique: fail } } }),
      db.$extends({ query: { demandOrder: { findFirst: fail } } }),
    ];
    for (const client of clients) {
      await assert.rejects(read(request(cookie), demand.id, client as unknown as Pick<PrismaClient, "$transaction">), error => {
        assert.ok(error instanceof OwnerAccessError);
        assert.equal(error.status, 503);
        assert.equal(error.code, "DATABASE_UNAVAILABLE");
        assert.doesNotMatch(error.message, /private|connection/);
        return true;
      });
    }
    const unavailable = db.$extends({ query: { ownerSession: { create: fail, updateMany: fail } } });
    await assert.rejects(unavailable.$transaction(tx => issueOwnerSession(owner, tx as unknown as Prisma.TransactionClient)), denied("DATABASE_UNAVAILABLE"));
    await assert.rejects(unavailable.$transaction(tx => revokeOwnerSession(request(cookie), tx as unknown as Prisma.TransactionClient)), denied("DATABASE_UNAVAILABLE"));
    const wrongScope = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) {
      const row = await query(args); return row && { ...row, ownerId: "owner-two" };
    } } } });
    await assert.rejects(read(request(cookie), demand.id, wrongScope as unknown as Pick<PrismaClient, "$transaction">), denied("DATABASE_UNAVAILABLE"));
  });

  await t.test("实际会话和授权器接入 B 内核：写后重连读到相同报价，保留 null/零元并过滤状态", async () => {
    const provider = { userId: DEMO_PROVIDER_USER_ID, role: "provider" as const, providerId: DEMO_PROVIDER_ID };
    const write = new Request(`${origin}/api/quote`, { method: "POST", headers: { "Idempotency-Key": "owner-read-roundtrip-key" } });
    const input = QuoteSubmissionInput.parse({ demandId: demand.id, estimatedDays: 5, items: [
      { code: "paid", name: "Synthetic paid", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "" },
      { code: "unknown", name: "Synthetic unknown", unit: "job", quantity: 1, unitPriceCents: null, note: "" },
      { code: "free", name: "Synthetic free", unit: "job", quantity: 1, unitPriceCents: 0, note: "" },
    ] });
    const saved = await createQuoteAtomically(write, input, provider, async () => provider, db);
    const row = await db.quote.findUniqueOrThrow({ where: { id: saved.quote.id } });
    await db.quote.createMany({ data: [{ ...row, id: "hidden-draft", status: "draft", itemsJson: "invalid" },
      { ...row, id: "hidden-rejected", status: "rejected" }, { ...row, id: "other-quote", demandId: "other-demand" }] });
    await db.$disconnect();
    const result = await read();
    assert.deepEqual(result?.response.data, [saved.quote]);
    assert.deepEqual(result?.response.data[0].items.map(item => item.amountCents), [15, null, 0]);
    assert.equal(result?.response.meta.source, "mock");
    assert.equal(result?.response.data[0].source, "mock");
    await db.quote.update({ where: { id: row.id }, data: { status: "accepted" } });
    await db.demandOrder.update({ where: { id: demand.id }, data: { status: "completed" } });
    assert.equal((await read())?.response.data[0].status, "accepted");
    await assert.rejects(read(request(cookie), "other-demand"), denied("DEMAND_NOT_FOUND"));
    const otherCookie = (await issue({ ...owner, userId: "owner-two" })).cookie.split(";")[0];
    assert.equal((await read(request(otherCookie), "other-demand"))?.response.data[0].id, "other-quote");
    await assert.rejects(read(request(otherCookie)), denied("DEMAND_NOT_FOUND"));
  });
});
