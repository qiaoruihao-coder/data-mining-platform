import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { DemandDeleteResult, envelope, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, type OwnerIdentityDTO } from "../src/contracts";
import { handleDemandDelete } from "../src/lib/demand-delete";
import { DEMO_SESSION_COOKIE, issueDemoSession } from "../src/lib/demo-provider-session";
import { issueOwnerSession, OWNER_SESSION_COOKIE, revokeOwnerSession } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const owner: OwnerIdentityDTO = { userId: "synthetic-owner", role: "owner", providerId: null };
const demandId = "owned-demand";
const original = { description: "Synthetic deletion fixture", city: "Test", areaM2: 10,
  budgetMinCents: 100, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 5,
  ownerId: owner.userId, status: "published" };
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "") => new Request(`${origin}/api/demand/${demandId}`, {
  method: "DELETE", headers: { origin, cookie },
});
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
// Fault/timing injection decorates real transactions; credential verification is never replaced.
function decorated(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) =>
    db.$transaction(async tx => run(await transform(tx)), options) } as unknown as Database;
}
function interceptDelete(tx: Prisma.TransactionClient, action: (args: Prisma.DemandOrderDeleteManyArgs) => Promise<unknown>) {
  return new Proxy(tx, { get(target, key) {
    if (key !== "demandOrder") return Reflect.get(target, key);
    return new Proxy(tx.demandOrder, { get(delegate, method) {
      return method === "deleteMany" ? action : Reflect.get(delegate, method);
    } });
  } });
}

test("需求 DELETE：隔离 SQLite、合成业务数据与实际业主凭证", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-demand-delete-"));
  const databasePath = join(fixture, "demand.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await Promise.all([db.$disconnect(), other.$disconnect()]);
    const target = resolve(fixture);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-D-demand-delete-"));
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
    for (const clear of [() => db.quote.deleteMany(), () => db.schedule.deleteMany(), () => db.payment.deleteMany(),
      () => db.review.deleteMany(), () => db.ticket.deleteMany()]) await clear();
    await db.demandOrder.upsert({ where: { id: demandId }, create: { ...original, id: demandId }, update: original });
  };
  const row = () => db.demandOrder.findUnique({ where: { id: demandId } });
  const remove = (req = request(cookie), id = demandId, client: Database = db) => handleDemandDelete(req, id, client);
  t.beforeEach(reset);

  await t.test("本人 draft/published 实际删除，公共结果 live；重复删除为 404", async () => {
    for (const status of ["draft", "published"]) {
      await reset();
      await db.demandOrder.update({ where: { id: demandId }, data: { status } });
      const response = await remove();
      privateResponse(response);
      assert.equal(response.status, 200);
      assert.deepEqual(envelope(DemandDeleteResult).parse(await response.json()), {
        ok: true, data: { id: demandId, deleted: true }, meta: { source: "live" },
      });
      await db.$disconnect();
      assert.equal(await row(), null);
      await rejected(await remove(), 404, "DEMAND_NOT_FOUND");
    }
  });

  await t.test("非空 ID 原值精确删除；不误删 trim 后的另一条需求", async () => {
    const before = await db.demandOrder.findUnique({ where: { id: exactId.trim() } });
    const response = await remove(request(cookie), exactId);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.id, exactId);
    assert.equal(await db.demandOrder.findUnique({ where: { id: exactId } }), null);
    assert.deepEqual(await db.demandOrder.findUnique({ where: { id: exactId.trim() } }), before);
  });

  await t.test("路径及同源校验先于存储；无正文读取或客户端身份信任", async () => {
    let transactions = 0;
    const unavailable = { $transaction: async () => { transactions++; throw new Error("private database"); } } as unknown as Database;
    for (const id of ["", " \t "]) await rejected(await remove(request(), id, unavailable), 400, "VALIDATION_ERROR");
    for (const headers of [
      { origin: "" }, { origin: "https://evil.test" }, { origin: "http://localhost:3000" },
      { origin: "https://localhost:3001" }, { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" },
      { host: "127.0.0.1:3000" },
    ]) {
      const req = request(cookie);
      for (const [key, value] of Object.entries(headers)) req.headers.set(key, value);
      await rejected(await remove(req, demandId, unavailable), 403, "FORBIDDEN");
    }
    await rejected(await remove(new Request(`${origin}/api/demand/${demandId}`, { headers: { origin, cookie } }), demandId, unavailable), 403, "FORBIDDEN");
    assert.equal(transactions, 0);
    const req = new Request(`${origin}/api/demand/${demandId}?ownerId=owner-two`, {
      method: "DELETE", headers: { origin: "https://127.0.0.1:3000", host: "127.0.0.1:3000", cookie,
        "x-user-id": "owner-two", "x-role": "admin" }, body: "{",
    });
    assert.equal((await remove(req)).status, 200);
    assert.equal(req.bodyUsed, false);
  });

  await t.test("匿名/伪造/重复/过期/撤销/删除账户与演示服务方凭证拒绝，认证失败不读需求", async () => {
    const expired = (await issue()).cookie.split(";")[0];
    await db.ownerSession.update({ where: { tokenHash: hash(expired) }, data: { expiresAt: new Date(0) } });
    const revoked = (await issue()).cookie.split(";")[0];
    await db.$transaction(tx => revokeOwnerSession(request(revoked), tx));
    await db.user.create({ data: { id: "temporary-owner", name: "Synthetic temporary", role: "owner" } });
    const deleted = (await issue({ ...owner, userId: "temporary-owner" })).cookie.split(";")[0];
    await db.user.delete({ where: { id: "temporary-owner" } });
    process.env.DEMO_AUTH_ENABLED = "true";
    const demo = await issueDemoSession(request(), db);
    let reads = 0;
    const observed = db.$extends({ query: { demandOrder: { async findFirst({ args, query }) { reads++; return query(args); } } } });
    const before = await row();
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=synthetic-owner`, `${OWNER_SESSION_COOKIE}=${"0".repeat(64)}`,
      `${cookie}; ${cookie}`, expired, revoked, deleted, `${DEMO_SESSION_COOKIE}=${demo.token}`]) {
      const req = request(credential);
      req.headers.set("x-user-id", owner.userId);
      await rejected(await remove(req, demandId, observed as unknown as Database), 401, "UNAUTHENTICATED");
    }
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: owner.userId }, data: { role } });
      await rejected(await remove(request(cookie), demandId, observed as unknown as Database), 403, "FORBIDDEN");
    }
    assert.equal(reads, 0);
    assert.deepEqual(await row(), before);
  });

  await t.test("他人和不存在需求同一 404；不泄露他人的状态/关联或演示只读信息", async () => {
    const before = await db.demandOrder.findMany();
    const missing = await rejected(await remove(request(cookie), "missing"), 404, "DEMAND_NOT_FOUND");
    const foreign = await rejected(await remove(request(cookie), "foreign-demand"), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(foreign, missing);
    const otherCookie = (await issue({ ...owner, userId: "owner-two" })).cookie.split(";")[0];
    assert.deepEqual(await rejected(await remove(request(otherCookie), "demo-demand"), 404, "DEMAND_NOT_FOUND"), missing);
    assert.deepEqual(await db.demandOrder.findMany(), before);
  });

  await t.test("本人演示只读及所有不可编辑状态均保留数据", async () => {
    await rejected(await remove(request(cookie), "demo-demand"), 409, "DEMO_DEMAND_READ_ONLY");
    for (const status of ["contracted", "in_progress", "completed", "unknown"]) {
      await db.demandOrder.update({ where: { id: demandId }, data: { status } });
      const before = await row();
      await rejected(await remove(), 409, "INVALID_STATE");
      assert.deepEqual(await row(), before);
    }
  });

  const relations: Array<(tx: Prisma.TransactionClient) => Promise<unknown>> = [
    tx => tx.quote.create({ data: { demandId, providerId: DEMO_PROVIDER_ID, itemsJson: "[]", knownTotalCents: 0, pendingItemsJson: "[]", estimatedDays: 1, status: "rejected" } }),
    tx => tx.schedule.create({ data: { demandId, version: 1, tasksJson: "[]" } }),
    tx => tx.payment.create({ data: { demandId, stage: "test", amountCents: 0 } }),
    tx => tx.review.create({ data: { demandId, providerId: DEMO_PROVIDER_ID, rating: 5, comment: "Synthetic" } }),
    tx => tx.ticket.create({ data: { demandId, description: "Synthetic", category: "test" } }),
  ];
  await t.test("五类关联均阻止删除，保留关联记录而非级联清除", async () => {
    for (const create of relations) {
      await reset();
      await db.$transaction(create);
      const before = await db.demandOrder.findUnique({ where: { id: demandId }, include: { _count: true } });
      await rejected(await remove(), 409, "DEMAND_HAS_RELATED_RECORDS");
      assert.deepEqual(await db.demandOrder.findUnique({ where: { id: demandId }, include: { _count: true } }), before);
    }
  });

  await t.test("事务内读取当前撤销/角色/归属；拒绝回滚注入变更", async () => {
    const changes = [
      { status: 401, code: "UNAUTHENTICATED", apply: (tx: Prisma.TransactionClient) => revokeOwnerSession(request(cookie), tx) },
      { status: 403, code: "FORBIDDEN", apply: (tx: Prisma.TransactionClient) => tx.user.update({ where: { id: owner.userId }, data: { role: "admin" } }) },
      { status: 404, code: "DEMAND_NOT_FOUND", apply: (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: demandId }, data: { ownerId: "owner-two" } }) },
    ];
    const before = await row();
    for (const change of changes) {
      const client = decorated(db, async tx => { await change.apply(tx); return tx; });
      await rejected(await remove(request(cookie), demandId, client), change.status, change.code);
      assert.deepEqual(await row(), before);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).role, "owner");
      assert.equal((await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash(cookie) } })).revokedAt, null);
    }
  });

  await t.test("最终 SQL 保护检查后变化的归属、状态和五类关联，失败原子回滚", async () => {
    const changes = [
      { status: 404, code: "DEMAND_NOT_FOUND", apply: (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: demandId }, data: { ownerId: "owner-two" } }) },
      { status: 409, code: "INVALID_STATE", apply: (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: demandId }, data: { status: "contracted" } }) },
      ...relations.map(apply => ({ status: 409, code: "DEMAND_HAS_RELATED_RECORDS", apply })),
    ];
    for (const change of changes) {
      const before = await db.demandOrder.findUnique({ where: { id: demandId }, include: { _count: true } });
      const client = decorated(db, async tx => interceptDelete(tx, async args => {
        await change.apply(tx);
        return tx.demandOrder.deleteMany(args);
      }));
      await rejected(await remove(request(cookie), demandId, client), change.status, change.code);
      assert.deepEqual(await db.demandOrder.findUnique({ where: { id: demandId }, include: { _count: true } }), before);
    }
  });

  await t.test("两连接并发状态变更/报价插入与删除，不误删已锁定或有关联的数据", async () => {
    for (const kind of ["state", "quote"]) {
      await reset();
      const mutation = kind === "state"
        ? other.demandOrder.update({ where: { id: demandId }, data: { status: "contracted" } })
        : other.quote.create({ data: { demandId, providerId: DEMO_PROVIDER_ID, itemsJson: "[]", knownTotalCents: 0, pendingItemsJson: "[]", estimatedDays: 1 } });
      const [change, deletion] = await Promise.allSettled([mutation, remove()]);
      assert.equal(deletion.status, "fulfilled");
      if (change.status === "fulfilled") {
        assert.ok([409, 503].includes(deletion.value.status));
        assert.ok(await row());
        if (kind === "state") assert.equal((await row())?.status, "contracted");
        else assert.equal(await db.quote.count({ where: { demandId } }), 1);
      } else {
        assert.ok([200, 503].includes(deletion.value.status));
        if (deletion.value.status === 200) assert.equal(await row(), null);
      }
    }
  });

  await t.test("并发重复删除最多一次成功，另一请求不能伪装成功", async () => {
    const responses = await Promise.all([remove(), remove(request(cookie), demandId, other)]);
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.ok(responses.every(response => [200, 404, 503].includes(response.status)));
    assert.equal(await row(), null);
  });

  await t.test("写后异常回滚；认证、查询、删除和事务故障均为中性 503", async () => {
    const before = await row();
    const fail = async () => { throw new Error("private database secret"); };
    const afterDelete = decorated(db, async tx => interceptDelete(tx, async args => {
      await tx.demandOrder.deleteMany(args);
      return fail();
    }));
    for (const client of [afterDelete,
      db.$extends({ query: { ownerSession: { findUnique: fail } } }),
      db.$extends({ query: { user: { findUnique: fail } } }),
      db.$extends({ query: { demandOrder: { findFirst: fail } } }),
      db.$extends({ query: { demandOrder: { deleteMany: fail } } }),
      { $transaction: fail },
    ]) {
      await rejected(await remove(request(cookie), demandId, client as unknown as Database), 503, "DATABASE_UNAVAILABLE");
      assert.deepEqual(await row(), before);
    }
  });

  await t.test("公开 DELETE 路由在隔离进程验证匿名拒绝、本人真实删除", async () => {
    const script = join(fixture, "public-delete.ts");
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { DELETE } from ${JSON.stringify(resolve("src/app/api/demand/[id]/route.ts").replaceAll("\\", "/"))};
      import { prisma } from ${JSON.stringify(resolve("src/lib/prisma.ts").replaceAll("\\", "/"))};
      async function main() {
        const request = (cookie = '') => new Request('${origin}/api/demand/${demandId}', {
          method: 'DELETE', headers: { origin: '${origin}', cookie }
        });
        const context = { params: { id: '${demandId}' } };
        assert.equal((await DELETE(request(), context)).status, 401);
        assert.ok(await prisma.demandOrder.findUnique({ where: { id: '${demandId}' } }));
        const response = await DELETE(request(process.env.D_DELETE_TEST_COOKIE), context);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(await response.json(), { ok: true, data: { id: '${demandId}', deleted: true }, meta: { source: 'live' } });
        assert.equal(await prisma.demandOrder.findUnique({ where: { id: '${demandId}' } }), null);
        console.log('public-delete-ok');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
    `);
    const output = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), script], {
      env: { ...process.env, DATABASE_URL: databaseUrl, D_DELETE_TEST_COOKIE: cookie }, encoding: "utf8", stdio: "pipe", timeout: 30000,
    });
    assert.match(output, /public-delete-ok/);
    assert.equal(await row(), null);
  });
});
