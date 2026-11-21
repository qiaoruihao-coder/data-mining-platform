import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Demand, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, envelope } from "../src/contracts";
import { demoDemand } from "../src/lib/mock-data";
import { OWNER_SESSION_COOKIE, issueOwnerSession, revokeOwnerSession } from "../src/lib/owner-auth";
import { DEMO_SESSION_COOKIE, issueDemoSession } from "../src/lib/demo-provider-session";
import { MATCHING_DEMAND_RESPONSE_HEADERS, MatchingDemandAccessError,
  matchingDemandFailureResponse, readMatchingDemand } from "../src/lib/matching-demand";

type Database = Pick<PrismaClient, "$transaction">;
const origin = "https://localhost:3000";
const request = (query = "?demandId=one-published", cookie = "", method = "GET") =>
  new Request(`${origin}/api/match${query}`, { method, headers: { cookie, origin } });
const queryFor = (id: string) => `?demandId=${encodeURIComponent(id)}`;
async function rejected(run: Promise<unknown>, status: number, code: string) {
  let body: unknown;
  await assert.rejects(run, asyncError => {
    assert.ok(asyncError instanceof MatchingDemandAccessError);
    assert.equal(asyncError.status, status);
    assert.equal(asyncError.code, code);
    body = asyncError;
    return true;
  });
  const response = matchingDemandFailureResponse(body as MatchingDemandAccessError);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["error", "ok"]);
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /private database|tokenHash|ownerId|secret/);
  return result;
}

test("匹配需求参数先验证；固定演示不访问数据库，显式 ID 不回退", async () => {
  let calls = 0;
  const unavailable = { $transaction: async () => { calls++; throw new Error("private database secret"); } } as unknown as Database;
  for (const query of ["?demandId=", "?demandId=%20%09", "?demandId=a&demandId=b", "?unknown=1", "?demandId=one&ownerId=other", "?demandId[]=one"]) {
    await rejected(readMatchingDemand(request(query), unavailable), 400, "VALIDATION_ERROR");
  }
  for (const method of ["POST", "PUT", "DELETE"]) {
    await rejected(readMatchingDemand(request("", "", method), unavailable), 403, "FORBIDDEN");
  }
  assert.deepEqual(await readMatchingDemand(request(""), unavailable), { ok: true, data: demoDemand, meta: { source: "mock" } });
  assert.equal(calls, 0);
  await rejected(readMatchingDemand(request(queryFor("demo-demand")), unavailable), 503, "DATABASE_UNAVAILABLE");
  assert.equal(calls, 1);
  assert.deepEqual(MATCHING_DEMAND_RESPONSE_HEADERS, { "Cache-Control": "private, no-store", Vary: "Cookie" });
});

test("匹配需求读取：隔离 SQLite、真实持久化会话与访问范围", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-matching-demand-"));
  const databasePath = join(fixture, "matching.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-matching-demand-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", resolve("prisma/schema.prisma"), "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  await db.user.createMany({ data: ["one", "two", "demo-owner"].map(id => ({ id, name: "Synthetic owner", role: "owner" })) });
  await db.serviceProvider.create({ data: { id: DEMO_PROVIDER_ID, name: "Synthetic provider", city: "Test", kind: "construction", tagsJson: "[]" } });
  await db.user.create({ data: { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider account", role: "provider", providerId: DEMO_PROVIDER_ID } });
  const issue = (userId: string) => db.$transaction(tx => issueOwnerSession({ userId, role: "owner", providerId: null }, tx));
  const issued = await issue("one");
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await issue("two")).cookie.split(";")[0];
  const demoCookie = (await issue("demo-owner")).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  process.env.DEMO_AUTH_ENABLED = "true";
  const provider = await issueDemoSession(request("", "", "POST"), db);
  const providerCookie = `${DEMO_SESSION_COOKIE}=${provider.token}`;
  const statuses = ["draft", "published", "contracted", "in_progress", "completed"];
  const exactId = " 需求/a?b#c%20 ";
  const base = { description: "Synthetic demand", city: "Test", areaM2: 10, budgetMinCents: 0,
    budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5 };
  const rows = [
    ...statuses.flatMap(status => [
      { ...base, id: `one-${status}`, ownerId: "one", status },
      { ...base, id: `two-${status}`, ownerId: "two", status },
    ]),
    { ...base, id: "demo-demand", ownerId: "demo-owner", status: "published" },
    { ...base, id: "demo-completed-a", ownerId: "one", status: "completed" },
    { ...base, id: exactId, ownerId: "one", status: "draft" },
    { ...base, id: exactId.trim(), ownerId: "two", status: "draft" },
  ];
  t.beforeEach(async () => {
    await db.user.update({ where: { id: "one" }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null, expiresAt: issued.expiresAt } });
    await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: rows });
  });
  const read = (id: string, value = cookie, client: Database = db) => readMatchingDemand(request(queryFor(id), value), client);
  const decorate = (before: (tx: Prisma.TransactionClient) => Promise<unknown>): Database => ({
    $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
      assert.equal(options.isolationLevel, "Serializable");
      return db.$transaction(async tx => { await before(tx); return run(tx); }, options);
    },
  } as unknown as Database);

  await t.test("匿名仅 published；非公开所有状态与不存在均为相同 404", async () => {
    const missing = await rejected(read("missing", ""), 404, "DEMAND_NOT_FOUND");
    for (const row of rows) {
      if (row.status !== "published") {
        assert.deepEqual(await rejected(read(row.id, ""), 404, "DEMAND_NOT_FOUND"), missing);
      } else {
        const body = await read(row.id, "");
        assert.equal(envelope(Demand).parse(body).data.id, row.id);
        assert.equal(body.meta.source, row.id === "demo-demand" ? "mock" : "live");
        assert.equal("ownerId" in body.data, false);
      }
    }
  });

  await t.test("两个业主可读本人全部状态及他人 published；SQL 使用当前身份且不接受伪造头", async () => {
    for (const [ownerId, value] of [["one", cookie], ["two", otherCookie]]) {
      const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) {
        assert.deepEqual(args.where?.OR, [{ status: "published" }, { ownerId }]);
        return query(args);
      } } } }) as unknown as Database;
      for (const status of statuses) assert.equal((await read(`${ownerId}-${status}`, value, observed)).data.status, status);
      const other = ownerId === "one" ? "two" : "one";
      assert.equal((await read(`${other}-published`, value, observed)).data.id, `${other}-published`);
      const missing = await rejected(read("missing", value, observed), 404, "DEMAND_NOT_FOUND");
      for (const status of statuses.filter(value => value !== "published")) {
        assert.deepEqual(await rejected(read(`${other}-${status}`, value, observed), 404, "DEMAND_NOT_FOUND"), missing);
      }
    }
    const forged = request(queryFor("two-draft"), cookie);
    forged.headers.set("x-user-id", "two"); forged.headers.set("x-role", "admin");
    await rejected(readMatchingDemand(forged, db), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("空白边界和特殊字符 ID 原样查找；HEAD 使用相同权限", async () => {
    assert.equal((await read(exactId)).data.id, exactId);
    await rejected(read(exactId.trim()), 404, "DEMAND_NOT_FOUND");
    assert.equal((await readMatchingDemand(request(queryFor("one-draft"), cookie, "HEAD"), db)).data.id, "one-draft");
    await rejected(readMatchingDemand(request(queryFor("one-draft"), "", "HEAD"), db), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("明确 demo ID 查询数据库且受发布/归属限制；无参数始终为固定样例", async () => {
    await db.demandOrder.update({ where: { id: "demo-demand" }, data: { status: "draft", description: "Synthetic changed demo" } });
    await rejected(read("demo-demand", ""), 404, "DEMAND_NOT_FOUND");
    await rejected(read("demo-demand", cookie), 404, "DEMAND_NOT_FOUND");
    const owned = await read("demo-demand", demoCookie);
    assert.equal(owned.data.description, "Synthetic changed demo"); assert.equal(owned.meta.source, "mock");
    assert.deepEqual((await readMatchingDemand(request("", cookie), db)).data, demoDemand);
    await db.demandOrder.delete({ where: { id: "demo-demand" } });
    await rejected(read("demo-demand", demoCookie), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual((await readMatchingDemand(request(""), db)).data, demoDemand);
  });

  await t.test("错误/重复/未知/过期/撤销业主 cookie 在公开与固定 demo 入口也拒绝，不读取需求", async () => {
    let demandReads = 0;
    const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) { demandReads++; return query(args); } } } }) as unknown as Database;
    for (const invalid of [`${OWNER_SESSION_COOKIE}=bad`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`, `${cookie}; ${cookie}`, `${OWNER_SESSION_COOKIE}=`]) {
      for (const query of ["", queryFor("one-published"), queryFor("one-draft")]) {
        await rejected(readMatchingDemand(request(query, invalid), observed), 401, "UNAUTHENTICATED");
      }
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(0) } });
    await rejected(read("one-published", cookie, observed), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { expiresAt: issued.expiresAt } });
    await db.$transaction(tx => revokeOwnerSession(request("", cookie), tx));
    await rejected(readMatchingDemand(request("", cookie), observed), 401, "UNAUTHENTICATED");
    assert.equal(demandReads, 0);
  });

  await t.test("账号角色变化拒绝；服务方仅公开范围，双 cookie 仍以业主为准", async () => {
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: "one" }, data: { role } });
      await rejected(read("one-published"), 403, "FORBIDDEN");
      await rejected(readMatchingDemand(request("", cookie), db), 403, "FORBIDDEN");
    }
    await db.user.update({ where: { id: "one" }, data: { role: "owner" } });
    assert.equal((await read("one-published", providerCookie)).meta.source, "live");
    await rejected(read("one-draft", providerCookie), 404, "DEMAND_NOT_FOUND");
    assert.equal((await read("one-draft", `${providerCookie}; ${cookie}`)).data.id, "one-draft");
    await rejected(read("one-published", `${providerCookie}; ${OWNER_SESSION_COOKIE}=bad`), 401, "UNAUTHENTICATED");
    await db.user.create({ data: { id: "removed-owner", name: "Synthetic removed", role: "owner" } });
    const removedCookie = (await issue("removed-owner")).cookie.split(";")[0];
    await db.user.delete({ where: { id: "removed-owner" } });
    await rejected(read("one-published", removedCookie), 401, "UNAUTHENTICATED");
  });

  await t.test("同一事务的会话撤销、角色与归属变化立即生效，拒绝后回滚", async () => {
    const changes = [
      { status: 401, code: "UNAUTHENTICATED", apply: (tx: Prisma.TransactionClient) => revokeOwnerSession(request("", cookie), tx) },
      { status: 403, code: "FORBIDDEN", apply: (tx: Prisma.TransactionClient) => tx.user.update({ where: { id: "one" }, data: { role: "admin" } }) },
      { status: 404, code: "DEMAND_NOT_FOUND", apply: (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one-draft" }, data: { ownerId: "two" } }) },
    ];
    for (const change of changes) {
      await rejected(read("one-draft", cookie, decorate(change.apply)), change.status, change.code);
      assert.equal((await read("one-draft")).data.id, "one-draft");
    }
  });

  await t.test("每次重新读取发布状态和内容，独立连接写入后撤销公开可见性", async () => {
    assert.equal((await read("one-published", "")).data.city, "Test");
    await second.demandOrder.update({ where: { id: "one-published" }, data: { city: "Changed", status: "draft" } });
    await rejected(read("one-published", ""), 404, "DEMAND_NOT_FOUND");
    assert.equal((await read("one-published")).data.city, "Changed");
    await second.demandOrder.delete({ where: { id: "one-published" } });
    await rejected(read("one-published"), 404, "DEMAND_NOT_FOUND");
  });

  await t.test("会话、账户、需求和事务故障均为中性 503；坏 DTO/错误范围不回退", async () => {
    const fail = async () => { throw new Error("private database secret"); };
    const clients = [
      db.$extends({ query: { ownerSession: { findUnique: fail } } }),
      db.$extends({ query: { user: { findUnique: fail } } }),
      db.$extends({ query: { demandOrder: { findFirst: fail } } }),
    ];
    for (const client of clients) await rejected(read("one-draft", cookie, client as unknown as Database), 503, "DATABASE_UNAVAILABLE");
    await rejected(read("one-draft", cookie, { $transaction: fail } as unknown as Database), 503, "DATABASE_UNAVAILABLE");
    for (const mutation of [{ areaM2: -1 }, { budgetMaxCents: -1 }, { renovationType: "invalid" }, { id: "another" }, { ownerId: "two" }]) {
      const client = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) {
        const row = await query(args); return row ? { ...row, ...mutation } : row;
      } } } }) as unknown as Database;
      await rejected(read("one-draft", cookie, client), 503, "DATABASE_UNAVAILABLE");
    }
  });

  await t.test("只读成功不续期或改业务数据，输出来源和字段遵循公共契约", async () => {
    const before = { demands: await db.demandOrder.findMany(), sessions: await db.ownerSession.findMany() };
    const live = await read("one-draft");
    assert.equal(live.meta.source, "live"); assert.equal(live.data.source, "live");
    assert.equal("ownerId" in live.data, false); assert.equal("createdAt" in live.data, false);
    assert.deepEqual(envelope(Demand).parse(live), live);
    const mock = await read("demo-demand");
    assert.equal(mock.meta.source, "mock"); assert.equal(mock.data.source, "mock");
    const completedDemo = await read("demo-completed-a");
    assert.equal(completedDemo.meta.source, "mock"); assert.equal(completedDemo.data.source, "mock");
    assert.deepEqual({ demands: await db.demandOrder.findMany(), sessions: await db.ownerSession.findMany() }, before);
  });
});
