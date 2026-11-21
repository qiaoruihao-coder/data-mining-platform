import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Review, ReviewInput, ReviewQuery, envelope } from "../src/contracts";
import { handleReviewCreate, handleReviewRead } from "../src/lib/review";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
const input = { demandId: "one", providerId: "provider-a", rating: 4, comment: " 合成评价，不代表实际施工。 " };
type Database = Pick<PrismaClient, "$transaction">;
const request = (cookie = "", body: unknown = input) => new Request(`${origin}/api/review`, {
  method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
});
function noCache(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
}
async function denied(response: Response, status: number, code: string) {
  noCache(response); assert.equal(response.status, status);
  const body = await response.json(); assert.equal(body.ok, false); assert.equal(body.error.code, code);
  assert.equal("data" in body, false); assert.equal("meta" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /private database|tokenHash|ownerId|itemsJson/);
  return body;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async tx => run(await transform(tx)), options);
  } } as unknown as Database;
}
function push(databaseUrl: string, schema = resolve("prisma/schema.prisma")) {
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", schema, "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
}

test("评价契约：精确 ID、整数星级、规范化可空评论、拒绝额外字段", () => {
  assert.deepEqual(ReviewInput.parse({ ...input, demandId: " one " }), { ...input, demandId: " one ", comment: input.comment.trim() });
  for (const rating of [1, 2, 3, 4, 5]) assert.ok(ReviewInput.safeParse({ ...input, rating }).success);
  for (const comment of ["", " \n ", "测".repeat(2000)]) assert.ok(ReviewInput.safeParse({ ...input, comment }).success);
  for (const field of ["demandId", "providerId"]) for (const value of ["", " ", null, undefined, 1]) {
    assert.equal(ReviewInput.safeParse({ ...input, [field]: value }).success, false);
  }
  for (const extra of [{ rating: 0 }, { rating: 6 }, { rating: 1.5 }, { rating: "5" }, { comment: null }, { comment: "x".repeat(2001) },
    { ownerId: "other" }, { orderId: "order" }, { source: "live" }, { id: "forged" }, { role: "owner" }, { status: "completed" }]) {
    assert.equal(ReviewInput.safeParse({ ...input, ...extra }).success, false);
  }
  assert.equal(ReviewQuery.safeParse({ demandId: "one", ownerId: "owner" }).success, false);
  for (const extra of [{ orderId: null }, { source: undefined }, { source: "unknown" }]) {
    assert.equal(Review.safeParse({ ...input, id: "review", orderId: "order", source: "mock", ...extra }).success, false);
  }
});

test("评价创建与读取：隔离 SQLite 的身份、资格、来源、回放、并发和回滚", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-review-"));
  const databasePath = join(fixture, "reviews.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect(); await second.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-review-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(databasePath, ""); push(databaseUrl);
  await db.user.createMany({ data: ["owner", "other"].map(id => ({ id, name: "Synthetic owner", role: "owner" })) });
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: "owner", role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: "other", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const hash = createHash("sha256").update(cookie.slice(OWNER_SESSION_COOKIE.length + 1)).digest("hex");
  await db.serviceProvider.createMany({ data: ["provider-a", "provider-b"].map(id => ({ id, name: "Synthetic", city: "Test", kind: "construction", tagsJson: "[]", rating: 3 })) });
  const demands = ["one", "two", "empty", "demo-demand", " one "].map(id => ({ id, ownerId: id === "two" ? "other" : "owner",
    description: "Synthetic completed fixture; no completion API", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000,
    renovationType: "repair", desiredDays: 10, status: "completed" }));
  const quotes = ["one", "two"].map(id => ({ id: `q-${id}`, demandId: id, providerId: "provider-a", source: "mock", status: "accepted",
    itemsJson: '[{"code":"pending","name":"待定","unit":"job","quantity":1,"unitPriceCents":null,"amountCents":null,"note":"合成"}]',
    pendingItemsJson: '["待定费用"]', knownTotalCents: 0, estimatedDays: 5 }));
  t.beforeEach(async () => {
    await db.user.update({ where: { id: "owner" }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { userId: "owner", revokedAt: null, expiresAt: issued.expiresAt } });
    await db.review.deleteMany(); await db.serviceOrder.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: demands }); await db.quote.createMany({ data: quotes });
    await db.serviceOrder.createMany({ data: ["one", "two"].map(id => ({ id: `o-${id}`, demandId: id, providerId: "provider-a", acceptedQuoteId: `q-${id}`, status: "completed", source: "mock" })) });
  });
  const create = (value: unknown = input, credential = cookie, client: Database = db) => handleReviewCreate(request(credential, value), client);
  const read = (query = "?demandId=one", credential = cookie, client: Database = second) => handleReviewRead(
    new Request(`${origin}/api/review${query}`, { headers: { cookie: credential } }), client);
  const business = async () => ({ demands: await db.demandOrder.findMany(), orders: await db.serviceOrder.findMany(), quotes: await db.quote.findMany(), providers: await db.serviceProvider.findMany() });

  await t.test("201 后第二连接读取一致，重放 200，mock 不升级；不改状态、报价或评分", async () => {
    const before = await business();
    const response = await create(); noCache(response); assert.equal(response.status, 201);
    const body = envelope(Review).parse(await response.json());
    assert.deepEqual(body, { ok: true, data: { ...input, comment: input.comment.trim(), id: body.data.id, orderId: "o-one", source: "mock" }, meta: { source: "mock" } });
    const stored = await read(); noCache(stored); assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), { ok: true, data: [body.data], meta: { source: "mock" } });
    const replay = await create({ ...input, comment: input.comment.trim() }); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), body);
    await denied(await create({ ...input, rating: 5 }), 409, "REVIEW_ALREADY_EXISTS");
    await denied(await create({ ...input, comment: "different" }), 409, "REVIEW_ALREADY_EXISTS");
    assert.equal(await db.review.count(), 1); assert.deepEqual(await business(), before);
  });

  await t.test("一致 live 关系保存 live；仅评分允许空评论", async () => {
    await db.quote.update({ where: { id: "q-one" }, data: { source: "live" } });
    await db.serviceOrder.update({ where: { id: "o-one" }, data: { source: "live" } });
    const response = await create({ ...input, comment: " \n " }); assert.equal(response.status, 201);
    const body = envelope(Review).parse(await response.json()); assert.equal(body.meta.source, "live"); assert.equal(body.data.source, "live"); assert.equal(body.data.comment, "");
    assert.deepEqual((await (await read()).json()).data, [body.data]);
  });

  await t.test("当前本人无评价才空数组；需求 ID 精确匹配，无匿名/无参数演示入口", async () => {
    for (const status of ["draft", "published", "contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: "empty" }, data: { status } });
      const response = await read("?demandId=empty"); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, data: [], meta: { source: "live" } });
    }
    await create();
    assert.deepEqual((await (await read("?demandId=%20one%20")).json()).data, []);
    assert.equal((await (await read("?demandId=demo-demand")).json()).meta.source, "mock");
    await denied(await read("", ""), 400, "VALIDATION_ERROR");
    await denied(await read("?demandId=demo-demand", ""), 401, "UNAUTHENTICATED");
  });

  await t.test("同源与身份预检在正文前；匿名/重复/坏 cookie/仅服务方拒绝读写", async () => {
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, "ai_home_demo_session=synthetic"]) {
      const req = request(credential); await denied(await handleReviewCreate(req, db), 401, "UNAUTHENTICATED"); assert.equal(req.bodyUsed, false);
      await denied(await read("?demandId=one", credential), 401, "UNAUTHENTICATED");
    }
    const forbidden: Record<string, string>[] = [{}, { origin: "https://other.example" }, { origin, "sec-fetch-site": "cross-site" }];
    for (const fields of forbidden) {
      const req = new Request(`${origin}/api/review`, { method: "POST", headers: { cookie, ...fields }, body: "{}" });
      await denied(await handleReviewCreate(req, db), 403, "FORBIDDEN"); assert.equal(req.bodyUsed, false);
    }
    assert.equal(await db.review.count(), 0);
  });

  await t.test("过期/撤销/角色变化拒绝；重放仍鉴权，双 cookie 不能回退", async () => {
    await create();
    for (const data of [{ expiresAt: new Date(0) }, { expiresAt: issued.expiresAt, revokedAt: new Date() }]) {
      await db.ownerSession.update({ where: { tokenHash: hash }, data });
      await denied(await create(input, `${cookie}; ai_home_demo_session=synthetic`), 401, "UNAUTHENTICATED");
      await denied(await read(), 401, "UNAUTHENTICATED");
    }
    await db.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: null } });
    for (const role of ["provider", "admin"]) {
      await db.user.update({ where: { id: "owner" }, data: { role } });
      await denied(await create(), 403, "FORBIDDEN"); await denied(await read(), 403, "FORBIDDEN");
    }
    assert.equal(await db.review.count(), 1);
  });

  await t.test("跨业主和不存在统一 404；演示只读；不接受自报服务方", async () => {
    for (const demandId of ["two", "missing"]) {
      await denied(await create({ ...input, demandId }), 404, "DEMAND_NOT_FOUND");
      await denied(await read(`?demandId=${demandId}`), 404, "DEMAND_NOT_FOUND");
    }
    await denied(await create(input, otherCookie), 404, "DEMAND_NOT_FOUND");
    await denied(await create({ ...input, demandId: "demo-demand" }), 409, "DEMO_DEMAND_READ_ONLY");
    for (const providerId of ["provider-b", "missing", " provider-a "]) await denied(await create({ ...input, providerId }), 409, "REVIEW_PROVIDER_MISMATCH");
    assert.equal(await db.review.count(), 0);
  });

  await t.test("必须有实际 completed 接单；只有 accepted 报价或未完工不可评价", async () => {
    for (const status of ["contracted", "in_progress"]) {
      await db.$transaction([db.serviceOrder.update({ where: { id: "o-one" }, data: { status } }), db.demandOrder.update({ where: { id: "one" }, data: { status } })]);
      await denied(await create(), 409, "REVIEW_NOT_ALLOWED");
    }
    await db.serviceOrder.delete({ where: { id: "o-one" } });
    for (const status of ["draft", "published", "completed"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } });
      await denied(await create(), 409, "REVIEW_NOT_ALLOWED");
    }
    assert.equal(await db.review.count(), 0);
  });

  await t.test("坏接单/报价来源、状态、跨需求/跨服务方关联及 JSON 均 503", async () => {
    const changes: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "unknown" } }),
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { source: "live" } }),
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { status: "contracted" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { status: "submitted" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { demandId: "two" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { providerId: "provider-b" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { itemsJson: "broken" } }),
    ];
    for (const change of changes) {
      let transactions = 0;
      const client = decorate(db, async tx => { if (++transactions === 2) await change(tx); return tx; });
      await denied(await create(input, cookie, client), 503, "REVIEW_UNAVAILABLE");
      await denied(await read("?demandId=one", cookie, decorate(db, async tx => { await change(tx); return tx; })), 503, "REVIEW_UNAVAILABLE");
    }
    assert.equal(await db.review.count(), 0);
  });

  await t.test("旧/孤立/错绑评价与重复旧行不隐藏为成功空列表，也不能覆盖", async () => {
    const variants = [
      { orderId: null }, { orderId: "o-one", source: "live" }, { orderId: "o-one", providerId: "provider-b" },
      { orderId: "o-one", demandId: "two" }, { orderId: "o-one", rating: 6 },
    ];
    for (const variant of variants) {
      await db.review.create({ data: { ...input, id: "bad", comment: "legacy", source: "mock", ...variant } });
      await denied(await read(), 503, "REVIEW_UNAVAILABLE"); await denied(await create(), 503, "REVIEW_UNAVAILABLE");
      assert.equal(await db.review.count(), 1); await db.review.deleteMany();
    }
    await db.review.createMany({ data: ["legacy-a", "legacy-b"].map(id => ({ ...input, id, comment: "legacy" })) });
    await denied(await read(), 503, "REVIEW_UNAVAILABLE"); await denied(await create(), 503, "REVIEW_UNAVAILABLE");
    assert.equal(await db.review.count(), 2);
  });

  await t.test("查询严格；坏 JSON、UTF-8 超限正文、身份和非法评分不写入", async () => {
    for (const query of ["", "?demandId=", "?demandId=%20", "?demandId=one&demandId=one", "?ownerId=owner", "?demandId=one&source=live"]) {
      await denied(await read(query), 400, "VALIDATION_ERROR");
      if (query) await denied(await handleReviewCreate(new Request(`${origin}/api/review${query}`, { method: "POST", headers: { origin, cookie } }), db), 400, "VALIDATION_ERROR");
    }
    for (const body of [undefined, "{"]) await denied(await handleReviewCreate(new Request(`${origin}/api/review`, { method: "POST", headers: { origin, cookie }, body }), db), 400, "INVALID_JSON");
    for (const value of [{ ...input, rating: 0 }, { ...input, ownerId: "other" }, { ...input, huge: "测".repeat(6000) }]) await denied(await create(value), 400, "VALIDATION_ERROR");
    assert.equal(await db.review.count(), 0);
  });

  await t.test("写事务重验会话/角色/身份/归属及完成状态", async () => {
    const changes: [number, string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
      [401, "UNAUTHENTICATED", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })],
      [403, "FORBIDDEN", tx => tx.user.update({ where: { id: "owner" }, data: { role: "admin" } })],
      [403, "FORBIDDEN", tx => tx.ownerSession.update({ where: { tokenHash: hash }, data: { userId: "other" } })],
      [404, "DEMAND_NOT_FOUND", tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "other" } })],
      [409, "REVIEW_NOT_ALLOWED", async tx => { await tx.serviceOrder.update({ where: { id: "o-one" }, data: { status: "in_progress" } }); await tx.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } }); }],
    ];
    for (const [status, code, change] of changes) {
      let transactions = 0;
      const client = decorate(db, async tx => { if (++transactions === 2) await change(tx); return tx; });
      await denied(await create(input, cookie, client), status, code); assert.equal(transactions, 2);
      assert.equal(await db.review.count(), 0); assert.equal((await db.ownerSession.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt, null);
    }
  });

  await t.test("最终写入限制归属/完成状态/报价原值，竞争变更失败整笔回滚", async () => {
    const changes: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [
      tx => tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "other" } }),
      tx => tx.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } }),
      tx => tx.serviceOrder.update({ where: { id: "o-one" }, data: { status: "in_progress" } }),
      tx => tx.quote.update({ where: { id: "q-one" }, data: { itemsJson: "[]" } }),
      tx => tx.review.create({ data: { ...input, id: "competitor", orderId: "o-one", source: "mock" } }),
    ];
    const before = await business();
    for (const change of changes) {
      const client = decorate(db, async tx => ({ ...tx, demandOrder: { ...tx.demandOrder,
        update: async (args: Prisma.DemandOrderUpdateArgs) => { await change(tx); return tx.demandOrder.update(args); },
      } } as unknown as Prisma.TransactionClient));
      await denied(await create(input, cookie, client), 503, "REVIEW_UNAVAILABLE");
      assert.equal(await db.review.count(), 0); assert.deepEqual(await business(), before);
    }
  });

  await t.test("写后输出异常回滚，数据库故障无成功空态或底层信息泄露", async () => {
    const client = decorate(db, async tx => ({ ...tx, review: { ...tx.review,
      findUniqueOrThrow: async (args: Prisma.ReviewFindUniqueOrThrowArgs) => ({ ...await tx.review.findUniqueOrThrow(args), rating: 6 }),
    } } as unknown as Prisma.TransactionClient));
    await denied(await create(input, cookie, client), 503, "REVIEW_UNAVAILABLE"); assert.equal(await db.review.count(), 0);
    const down = { $transaction: async () => { throw new Error("private database details"); } } as unknown as Database;
    await denied(await create(input, cookie, down), 503, "REVIEW_UNAVAILABLE"); await denied(await read("?demandId=one", cookie, down), 503, "REVIEW_UNAVAILABLE");
  });

  await t.test("数据库唯一约束与两连接并发：同一接单最多一条；可读取确认结果", async () => {
    const results = await Promise.all([create(), create(input, cookie, second)]);
    assert.equal(results.filter(response => response.status === 201).length, 1);
    assert.ok(results.every(response => [200, 201, 503].includes(response.status)));
    for (const response of results) if (response.status === 503) await denied(response, 503, "REVIEW_UNAVAILABLE");
    assert.equal(await db.review.count(), 1);
    const saved = (await (await read()).json()).data[0]; assert.equal(saved.orderId, "o-one");
    await assert.rejects(db.review.create({ data: { ...saved, id: "duplicate" } }), (error: unknown) => (error as { code: string }).code === "P2002");
    await assert.rejects(db.serviceOrder.delete({ where: { id: "o-one" } }));
    const replay = await create(); assert.equal(replay.status, 200); assert.equal((await replay.json()).data.id, saved.id);
  });
});

test("真实旧表同步保留重复历史评价，默认 mock 与空关系，不自动造履约", async t => {
  const tempRoot = resolve(tmpdir()); const fixture = mkdtempSync(join(tempRoot, "ai-home-D-review-upgrade-"));
  const databasePath = join(fixture, "legacy.db"); const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => { await db.$disconnect(); assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-review-upgrade-")); rmSync(fixture, { recursive: true, force: true }); });
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8").replace("  review Review?\n", "").replace("  review Review?\r\n", "")
    .replace(/model Review \{[\s\S]*?\n\}/, 'model Review {\n  id String @id @default(cuid())\n  demandId String\n  demand DemandOrder @relation(fields: [demandId], references: [id])\n  providerId String\n  rating Int\n  comment String\n}');
  const oldSchema = join(fixture, "old.prisma"); writeFileSync(oldSchema, schema); writeFileSync(databasePath, ""); push(databaseUrl, oldSchema);
  await db.user.create({ data: { id: "legacy-owner", name: "Synthetic" } });
  await db.demandOrder.create({ data: { id: "legacy", ownerId: "legacy-owner", description: "Synthetic", city: "Test", areaM2: 10, budgetMinCents: 0, budgetMaxCents: 100, renovationType: "repair", desiredDays: 1 } });
  for (const id of ["old-a", "old-b"]) await db.$executeRaw`INSERT INTO Review (id, demandId, providerId, rating, comment) VALUES (${id}, 'legacy', 'unverified-provider', 3, 'Legacy content')`;
  await db.$disconnect(); push(databaseUrl); push(databaseUrl);
  const rows = await db.review.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(rows, ["old-a", "old-b"].map(id => ({ id, demandId: "legacy", providerId: "unverified-provider", rating: 3, comment: "Legacy content", source: "mock", orderId: null })));
  assert.equal(await db.serviceOrder.count(), 0);
});
