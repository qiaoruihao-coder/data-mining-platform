import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Demand, DemandUpdateInput, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, envelope, type OwnerIdentityDTO } from "../src/contracts";
import { handleDemandUpdate } from "../src/lib/demand-update";
import { toDemandDTO } from "../src/lib/demand";
import { DEMO_SESSION_COOKIE, issueDemoSession } from "../src/lib/demo-provider-session";
import { issueOwnerSession, OWNER_SESSION_COOKIE, revokeOwnerSession } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const owner: OwnerIdentityDTO = { userId: "synthetic-owner", role: "owner", providerId: null };
const input = { description: "  合成测试：修改浴室防滑需求。  ", city: " 深圳 ", areaM2: 55.5,
  budgetMinCents: 0, budgetMaxCents: 400000, renovationType: "elderly", desiredDays: 15 };
const original = { description: "Synthetic original demand", city: "Test", areaM2: 10,
  budgetMinCents: 100, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5,
  ownerId: owner.userId, status: "published" };
const demandId = "owned-demand";
type Database = Pick<PrismaClient, "$transaction">;

function request(cookie = "", body = JSON.stringify(input)) {
  return new Request(`${origin}/api/demand/${demandId}`, { method: "PUT",
    headers: { origin, cookie, "content-type": "application/json" }, body });
}

function privateResponse(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}

async function rejected(response: Response, status: number, code: string) {
  privateResponse(response);
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /private database|secret|tokenHash/);
  return body;
}

// Only the real write transaction is decorated; authentication always reads actual persisted credentials.
function beforeWrite(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  let calls = 0;
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) =>
    db.$transaction(async tx => run(++calls === 2 ? await transform(tx) : tx), options) } as unknown as Database;
}

test("需求 PUT：隔离 SQLite、合成账号与真实随机业主凭证（不代表生产登录已交付）", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-demand-update-"));
  const databasePath = join(fixture, "demand.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect();
    const target = resolve(fixture);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-D-demand-update-"));
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
    { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider account", role: "provider", providerId: DEMO_PROVIDER_ID },
  ] });
  const exactId = " 需求/a?b#c%20 ";
  await db.demandOrder.createMany({ data: [
    { ...original, id: demandId }, { ...original, id: "foreign-demand", ownerId: "owner-two" },
    { ...original, id: "demo-demand" }, { ...original, id: exactId }, { ...original, id: exactId.trim() },
  ] });
  const issue = (identity = owner) => db.$transaction(tx => issueOwnerSession(identity, tx));
  const issued = await issue();
  const cookie = issued.cookie.split(";")[0];
  const hash = (value: string) => createHash("sha256").update(value.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  const reset = async () => {
    await db.user.update({ where: { id: owner.userId }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash(cookie) }, data: { userId: owner.userId, revokedAt: null, expiresAt: issued.expiresAt } });
    await db.demandOrder.update({ where: { id: demandId }, data: original });
  };
  const row = () => db.demandOrder.findUniqueOrThrow({ where: { id: demandId } });
  const put = (req = request(cookie), id = demandId, client: Database = db) => handleDemandUpdate(req, id, client);
  t.beforeEach(reset);

  await t.test("本人 draft/published 完整替换、归一化并持久化；保留身份、状态及创建时间", async () => {
    for (const status of ["draft", "published"]) {
      await db.demandOrder.update({ where: { id: demandId }, data: { ...original, status } });
      const before = await row();
      const response = await put();
      assert.equal(response.status, 200);
      privateResponse(response);
      const body = envelope(Demand).parse(await response.json());
      assert.deepEqual(body, { ok: true, data: { id: demandId, ...DemandUpdateInput.parse(input), status, source: "live" }, meta: { source: "live" } });
      await db.$disconnect();
      const saved = await row();
      assert.deepEqual(toDemandDTO(saved), body.data);
      assert.equal(saved.ownerId, before.ownerId);
      assert.deepEqual(saved.createdAt, before.createdAt);
      assert.equal("ownerId" in body.data, false);
    }
  });

  await t.test("非空 ID 原值精确更新；不能误更新去除空白后的另一条需求", async () => {
    const before = await db.demandOrder.findUniqueOrThrow({ where: { id: exactId.trim() } });
    const response = await put(request(cookie), exactId);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.id, exactId);
    assert.deepEqual(await db.demandOrder.findUniqueOrThrow({ where: { id: exactId.trim() } }), before);
    for (const id of ["", " \t "]) await rejected(await put(request(), id), 400, "VALIDATION_ERROR");
  });

  await t.test("同源拒绝先于数据库和请求体读取，路径错误先于同源检查", async () => {
    let transactions = 0;
    const unavailable = { $transaction: async () => { transactions++; throw new Error("private database"); } } as unknown as Database;
    for (const headers of [
      { origin: "" }, { origin: "https://evil.test" }, { origin: "http://localhost:3000" },
      { origin: "https://localhost:3001" }, { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" },
      { host: "127.0.0.1:3000" },
    ]) {
      const req = request(cookie, "{");
      for (const [key, value] of Object.entries(headers)) req.headers.set(key, value);
      await rejected(await put(req, demandId, unavailable), 403, "FORBIDDEN");
      assert.equal(req.bodyUsed, false);
    }
    await rejected(await put(request(), " ", unavailable), 400, "VALIDATION_ERROR");
    assert.equal(transactions, 0);
    const loopback = request(cookie);
    loopback.headers.set("host", "127.0.0.1:3000");
    loopback.headers.set("origin", "https://127.0.0.1:3000");
    assert.equal((await put(loopback)).status, 200);
  });

  await t.test("匿名/伪造/重复/过期/撤销及删除账户凭证拒绝，预检不消费 JSON 或读取需求", async () => {
    const expired = (await issue()).cookie.split(";")[0];
    await db.ownerSession.update({ where: { tokenHash: hash(expired) }, data: { expiresAt: new Date(0) } });
    const revoked = (await issue()).cookie.split(";")[0];
    await db.$transaction(tx => revokeOwnerSession(request(revoked), tx));
    await db.user.create({ data: { id: "temporary-owner", name: "Synthetic temporary", role: "owner" } });
    const deleted = (await issue({ ...owner, userId: "temporary-owner" })).cookie.split(";")[0];
    await db.user.delete({ where: { id: "temporary-owner" } });
    process.env.DEMO_AUTH_ENABLED = "true";
    const demo = await issueDemoSession(request(), db);
    let businessReads = 0;
    const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) { businessReads++; return query(args); } } } });
    const before = await row();
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=synthetic-owner`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`,
      `${cookie}; ${cookie}`, expired, revoked, deleted, `${DEMO_SESSION_COOKIE}=${demo.token}`]) {
      const req = request(credential, "{");
      req.headers.set("x-user-id", owner.userId);
      req.headers.set("x-role", "owner");
      await rejected(await put(req, demandId, observed as unknown as Database), 401, "UNAUTHENTICATED");
      assert.equal(req.bodyUsed, false);
    }
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } });
      const req = request(cookie, "{");
      await rejected(await put(req, demandId, observed as unknown as Database), 403, "FORBIDDEN");
      assert.equal(req.bodyUsed, false);
    }
    assert.equal(businessReads, 0);
    assert.deepEqual(await row(), before);
  });

  await t.test("缺失与跨业主需求同一 404，查询包含当前 ownerId，自报身份无效", async () => {
    let reads = 0;
    const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) {
      reads++;
      assert.equal(args.where?.ownerId, owner.userId);
      return query(args);
    } } } });
    const bodies = [];
    const before = await db.demandOrder.findMany();
    for (const id of ["missing-demand", "foreign-demand"]) {
      const req = request(cookie);
      req.headers.set("x-user-id", "owner-two");
      bodies.push(await rejected(await put(req, id, observed as unknown as Database), 404, "DEMAND_NOT_FOUND"));
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(reads, 2);
    assert.deepEqual(await db.demandOrder.findMany(), before);
  });

  await t.test("鉴权后的 JSON、预算、字段校验及只读/锁定状态拒绝均不写入", async () => {
    const before = await row();
    await rejected(await put(request(cookie, "{")), 400, "INVALID_JSON");
    for (const body of [null, {}, { ...input, budgetMinCents: 400001 }, { ...input, areaM2: 0 },
      { ...input, desiredDays: 0 }, { ...input, city: " " }, { ...input, budgetMinCents: 1.5 },
      ...["ownerId", "id", "status", "source"].map(key => ({ ...input, [key]: "forged" }))]) {
      await rejected(await put(request(cookie, JSON.stringify(body))), 400, "VALIDATION_ERROR");
    }
    assert.deepEqual(await row(), before);
    await rejected(await put(request(cookie), "demo-demand"), 409, "DEMO_DEMAND_READ_ONLY");
    const otherCookie = (await issue({ ...owner, userId: "owner-two" })).cookie.split(";")[0];
    await rejected(await put(request(otherCookie), "demo-demand"), 404, "DEMAND_NOT_FOUND");
    for (const status of ["contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: demandId }, data: { status } });
      await rejected(await put(), 409, "INVALID_STATE");
      assert.deepEqual(await row(), { ...before, status });
    }
  });

  const changes: Array<{ status: number; code: string; apply: (tx: Prisma.TransactionClient) => Promise<unknown> }> = [
    { status: 401, code: "UNAUTHENTICATED", apply: tx => revokeOwnerSession(request(cookie), tx) },
    { status: 401, code: "UNAUTHENTICATED", apply: tx => tx.ownerSession.update({ where: { tokenHash: hash(cookie) }, data: { expiresAt: new Date(0) } }) },
    { status: 403, code: "FORBIDDEN", apply: tx => tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } }) },
    { status: 403, code: "FORBIDDEN", apply: tx => tx.ownerSession.update({ where: { tokenHash: hash(cookie) }, data: { userId: "owner-two" } }) },
    { status: 404, code: "DEMAND_NOT_FOUND", apply: tx => tx.demandOrder.update({ where: { id: demandId }, data: { ownerId: "owner-two" } }) },
    { status: 409, code: "INVALID_STATE", apply: tx => tx.demandOrder.update({ where: { id: demandId }, data: { status: "contracted" } }) },
  ];

  await t.test("预检后、写事务前的会话/账户/归属/状态变化重新读取并拒绝", async () => {
    for (const change of changes) {
      await reset();
      const req = request(cookie);
      const readBody = req.json.bind(req);
      req.json = async () => {
        const body = await readBody();
        // A separate committed transaction proves body parsing is outside the auth/write transactions.
        await db.$transaction(tx => change.apply(tx));
        return body;
      };
      await rejected(await put(req), change.status, change.code);
      assert.equal((await row()).description, original.description);
    }
  });

  await t.test("写事务内的身份、归属和状态变化可见，拒绝会回滚整个事务", async () => {
    const before = await row();
    const sessionBefore = await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash(cookie) } });
    for (const change of changes) {
      const client = beforeWrite(db, async tx => { await change.apply(tx); return tx; });
      await rejected(await put(request(cookie), demandId, client), change.status, change.code);
      assert.deepEqual(await row(), before);
      assert.deepEqual(await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash(cookie) } }), sessionBefore);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role, "owner");
    }
  });

  await t.test("最后一次 SQL 同时限制 ID、业主和状态；读取后变化不能写入，变更回滚", async () => {
    const before = await row();
    for (const change of changes.slice(-2)) {
      let writes = 0;
      const client = beforeWrite(db, async tx => new Proxy(tx, { get(target, key) {
        if (key !== "demandOrder") return Reflect.get(target, key);
        return new Proxy(tx.demandOrder, { get(delegate, method) {
          if (method !== "updateMany") return Reflect.get(delegate, method);
          return async (args: Prisma.DemandOrderUpdateManyArgs) => {
            writes++;
            assert.deepEqual(args.where, { id: demandId, ownerId: owner.userId, status: { in: ["draft", "published"] } });
            await change.apply(tx);
            return tx.demandOrder.updateMany(args);
          };
        } });
      } }));
      await rejected(await put(request(cookie), demandId, client), change.status, change.code);
      assert.equal(writes, 1);
      assert.deepEqual(await row(), before);
    }
  });

  await t.test("更新后输出损坏必须在提交前回滚；存储故障返回中性 503 不泄露细节", async () => {
    const before = await row();
    const corrupt = beforeWrite(db, async tx => {
      let reads = 0;
      return new Proxy(tx, { get(target, key) {
        if (key !== "demandOrder") return Reflect.get(target, key);
        return new Proxy(tx.demandOrder, { get(delegate, method) {
          if (method !== "findFirst") return Reflect.get(delegate, method);
          return async (args: Prisma.DemandOrderFindFirstArgs) => {
            const found = await tx.demandOrder.findFirst(args);
            return ++reads === 2 && found ? { ...found, areaM2: -1 } : found;
          };
        } });
      } });
    });
    await rejected(await put(request(cookie), demandId, corrupt), 503, "DATABASE_UNAVAILABLE");
    assert.deepEqual(await row(), before);
    const fail = async () => { throw new Error("private database secret"); };
    for (const client of [
      db.$extends({ query: { ownerSession: { findUnique: fail } } }),
      db.$extends({ query: { user: { findUnique: fail } } }),
      db.$extends({ query: { demandOrder: { findFirst: fail } } }),
      db.$extends({ query: { demandOrder: { updateMany: fail } } }),
      { $transaction: fail },
    ]) {
      await rejected(await put(request(cookie), demandId, client as unknown as Database), 503, "DATABASE_UNAVAILABLE");
      assert.deepEqual(await row(), before);
    }
  });

  await t.test("默认公开 PUT 路由在隔离进程使用实际 Prisma 和凭证，匿名失败、本人成功", async () => {
    const script = join(fixture, "public-put.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { PUT } from ${JSON.stringify(resolve("src/app/api/demand/[id]/route.ts").replaceAll("\\", "/"))};
      import { prisma } from ${JSON.stringify(resolve("src/lib/prisma.ts").replaceAll("\\", "/"))};
      async function main() {
        const request = (cookie = '') => new Request('${origin}/api/demand/${demandId}', {
          method: 'PUT', headers: { origin: '${origin}', cookie }, body: ${JSON.stringify(JSON.stringify(input))}
        });
        const context = { params: { id: '${demandId}' } };
        const anonymous = await PUT(request(), context);
        assert.equal(anonymous.status, 401);
        const response = await PUT(request(process.env.D_DEMAND_TEST_COOKIE), context);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        const body = await response.json();
        const saved = await prisma.demandOrder.findUniqueOrThrow({ where: { id: '${demandId}' } });
        assert.equal(saved.city, body.data.city);
        assert.equal(body.meta.source, 'live');
        console.log('public-put-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl, D_DEMAND_TEST_COOKIE: cookie }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-put-ok/);
    assert.equal((await row()).city, "深圳");
  });
});
