import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Demand, DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, envelope } from "../src/contracts";
import { handleDemandDetail, handleDemandList } from "../src/lib/demand-read";
import { handleOrderAccept } from "../src/lib/order";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";
import { DEMO_SESSION_COOKIE, issueDemoSession, revokeDemoSession } from "../src/lib/demo-provider-session";

const origin = "https://localhost:3000";
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", query = "") => new Request(`${origin}/api/demand/one${query}`, { headers: { origin, cookie } });
async function checked(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  const raw = await response.json();
  assert.doesNotMatch(JSON.stringify(raw), /ownerId|acceptedQuote|tokenHash|private database/);
  if (status === 200) return envelope(Demand).parse(raw);
  assert.equal(raw.ok, false); assert.equal("data" in raw, false);
  assert.equal(raw.error.code, status === 404 ? "DEMAND_NOT_FOUND" : status === 503 ? "DATABASE_UNAVAILABLE" : status === 401 ? "UNAUTHENTICATED" : "VALIDATION_ERROR");
  return raw;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(tx => run(transform(tx)), options);
  } } as unknown as Database;
}

test("已接单服务方需求详情：实际关系、当前会话、SQL 范围及私有响应", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-provider-detail-"));
  const path = join(fixture, "detail.db");
  const databaseUrl = `file:${path.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const originalDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (originalDemo === undefined) delete process.env.DEMO_AUTH_ENABLED; else process.env.DEMO_AUTH_ENABLED = originalDemo;
    await db.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-provider-detail-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(path, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  await db.serviceProvider.createMany({ data: [DEMO_PROVIDER_ID, "provider-b"].map(id => ({ id, name: id, city: "Test", kind: "construction", tagsJson: "[]" })) });
  await db.user.createMany({ data: [{ id: "owner", name: "Synthetic owner", role: "owner" }, { id: "other", name: "Synthetic other", role: "owner" },
    { id: DEMO_PROVIDER_USER_ID, name: "Synthetic provider", role: "provider", providerId: DEMO_PROVIDER_ID }] });
  const cookie = (await db.$transaction(tx => issueOwnerSession({ userId: "owner", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: "other", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  let providerCookie: string;
  t.beforeEach(async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await db.serviceOrder.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
    for (const id of ["one", "other-provider", "legacy"]) {
      await db.demandOrder.create({ data: { id, ownerId: "owner", description: "Synthetic demand", city: "Test", areaM2: 20,
        budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 10, status: "published" } });
      await db.quote.create({ data: { id: `q-${id}`, demandId: id, providerId: id === "other-provider" ? "provider-b" : DEMO_PROVIDER_ID,
        source: "mock", status: "submitted", itemsJson: '[{"code":"test","name":"Synthetic","unit":"job","quantity":1,"unitPriceCents":100,"amountCents":100,"note":"test"}]',
        pendingItemsJson: "[]", knownTotalCents: 100, estimatedDays: 2 } });
    }
    providerCookie = `${DEMO_SESSION_COOKIE}=${(await issueDemoSession(request(), db)).token}`;
  });
  const detail = (id = "one", credential = providerCookie, client: Database = db) => handleDemandDetail(request(credential), id, client);
  const accept = async (id = "one") => {
    const result = await handleOrderAccept(new Request(`${origin}/api/order`, { method: "POST", headers: { origin, cookie },
      body: JSON.stringify({ demandId: id, quoteId: `q-${id}`, confirmed: true }) }), db);
    assert.equal(result.status, 201);
  };

  await t.test("实际接受后详情可读且保留来源；列表不扩大；匿名和其他业主仍 404", async () => {
    await accept();
    const body = await checked(await detail(), 200);
    assert.equal(body.meta.source, "mock"); assert.equal(body.data.source, "live"); assert.equal(body.data.status, "contracted");
    const missing = await checked(await detail("missing"), 404);
    assert.deepEqual(await checked(await detail("one", ""), 404), missing);
    assert.deepEqual(await checked(await detail("one", otherCookie), 404), missing);
    assert.equal((await checked(await detail("one", cookie), 200)).meta.source, "live");
    const list = await handleDemandList(request(providerCookie), db);
    const listed = envelope(Demand.array()).parse(await list.json());
    assert.ok(listed.data.every(row => row.status === "published" && row.id !== "one"));
    assert.equal(listed.meta.source, "mock");
    for (const status of ["in_progress", "completed"]) {
      await db.$transaction(async tx => {
        await tx.demandOrder.update({ where: { id: "one" }, data: { status } });
        await tx.serviceOrder.update({ where: { demandId: "one" }, data: { status } });
      });
      assert.equal((await checked(await detail(), 200)).data.status, status);
    }
  });

  await t.test("他人接单、仅历史 accepted 和已撤销关系均不授予私有详情权限", async () => {
    await accept("other-provider");
    await checked(await detail("other-provider"), 404);
    await db.demandOrder.update({ where: { id: "legacy" }, data: { status: "contracted" } });
    await db.quote.update({ where: { id: "q-legacy" }, data: { status: "accepted" } });
    await checked(await detail("legacy"), 404);
    await accept(); await db.serviceOrder.deleteMany({ where: { demandId: "one" } });
    await checked(await detail(), 404);
  });

  await t.test("会话关闭/伪造/重复/过期/退出/角色和绑定变化立即收回访问", async () => {
    await accept();
    for (const value of ["", `${DEMO_SESSION_COOKIE}=forged`, `${providerCookie}; ${providerCookie}`]) await checked(await detail("one", value), 404);
    process.env.DEMO_AUTH_ENABLED = "false"; await checked(await detail(), 404); process.env.DEMO_AUTH_ENABLED = "true";
    for (const data of [{ role: "owner" }, { role: "provider", providerId: "provider-b" }]) {
      await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data }); await checked(await detail(), 404);
    }
    await db.user.update({ where: { id: DEMO_PROVIDER_USER_ID }, data: { role: "provider", providerId: DEMO_PROVIDER_ID } });
    await checked(await detail(), 200);
    await db.demoProviderSession.updateMany({ data: { expiresAt: new Date(0) } }); await checked(await detail(), 404);
    providerCookie = `${DEMO_SESSION_COOKIE}=${(await issueDemoSession(request(), db)).token}`;
    await checked(await detail(), 200); await revokeDemoSession(request(providerCookie), db); await checked(await detail(), 404);
    assert.equal((await detail("legacy")).status, 200, "invalid provider may still read published records");
  });

  await t.test("双 cookie 保持业主优先，自报 providerId 不能改变授权", async () => {
    await accept();
    await checked(await detail("one", `${otherCookie}; ${providerCookie}`), 404);
    assert.equal((await checked(await detail("one", `${cookie}; ${providerCookie}`), 200)).meta.source, "live");
    await checked(await detail("one", `${OWNER_SESSION_COOKIE}=bad; ${providerCookie}`), 401);
    const forged = request(); forged.headers.set("x-provider-id", DEMO_PROVIDER_ID); forged.headers.set("x-role", "provider");
    await checked(await handleDemandDetail(forged, "one", db), 404);
    await checked(await handleDemandDetail(request(providerCookie, "?providerId=provider-a"), "one", db), 400);
  });

  await t.test("关系 SQL 限制当前 providerId；越界、状态/来源/报价异常或故障为 503", async () => {
    await accept();
    const observed = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
      findFirst: async (args: Prisma.DemandOrderFindFirstArgs) => {
        assert.deepEqual(args.where, { id: "one", OR: [{ status: "published" }, { serviceOrder: { is: { providerId: DEMO_PROVIDER_ID } } }] });
        return tx.demandOrder.findFirst(args);
      },
    } }) as unknown as Prisma.TransactionClient);
    await checked(await detail("one", providerCookie, observed), 200);
    const original = await db.demandOrder.findUniqueOrThrow({ where: { id: "one" }, include: { serviceOrder: { include: { acceptedQuote: true } } } });
    const order = original.serviceOrder!;
    for (const changed of [
      { id: "wrong" }, { status: "draft" }, { serviceOrder: null },
      ...[{ providerId: "provider-b" }, { demandId: "legacy" }, { status: "in_progress" }, { source: "unknown" },
        { acceptedQuote: { ...order.acceptedQuote, status: "submitted" } }, { acceptedQuote: { ...order.acceptedQuote, providerId: "provider-b" } },
        { acceptedQuote: { ...order.acceptedQuote, demandId: "legacy" } }, { acceptedQuote: { ...order.acceptedQuote, source: "live" } },
        { acceptedQuoteId: "wrong" }].map(data => ({ serviceOrder: { ...order, ...data } })),
    ]) {
      const corrupt = decorate(db, tx => ({ ...tx, demandOrder: { ...tx.demandOrder, findFirst: async () => ({ ...original, ...changed }) } }) as unknown as Prisma.TransactionClient);
      await checked(await detail("one", providerCookie, corrupt), 503);
    }
    await db.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } });
    await checked(await detail(), 503);
    const broken = { $transaction: async () => { throw new Error("private database"); } } as unknown as Database;
    await checked(await detail("one", providerCookie, broken), 503);
  });
});
