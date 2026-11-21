import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Provider, ProviderPerformance, ProviderQuery, envelope, type SourceDTO } from "../src/contracts";
import { providers } from "../src/lib/mock-data";
import { handleProviderDirectory, readProviderDirectory, ProviderDirectoryError } from "../src/lib/provider-directory";
import { handleReviewCreate } from "../src/lib/review";
import { issueOwnerSession } from "../src/lib/owner-auth";

type Database = Pick<PrismaClient, "$transaction">;
const origin = "https://localhost:3000";
const request = (query = "", cookie = "") => new Request(`${origin}/api/provider${query}`, { headers: { cookie } });
const performance = { basis: "completed_order_review_average", averageRating: null, reviewCount: 0,
  calculatedAt: "2026-01-01T00:00:00.000Z", source: "live" };
async function success(response: Response) {
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.json(); const result = envelope(Provider.array()).parse(raw);
  assert.equal(result.meta.source, "mock"); assert.equal(result.data.length, providers.length);
  assert.doesNotMatch(JSON.stringify(raw), /private-comment|private-owner|demandId|orderId|ownerId|acceptedQuoteId|comment|tokenHash|ratingSum/);
  assert.ok(result.data.every(provider => provider.source === "mock"));
  assert.equal(new Set(result.data.map(provider => provider.performance!.calculatedAt)).size, 1);
  return result;
}
async function denied(response: Response, status = 503, code = "PROVIDER_UNAVAILABLE") {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.json(); assert.equal(raw.ok, false); assert.equal(raw.error.code, code);
  assert.equal("data" in raw, false); assert.equal("meta" in raw, false);
  assert.doesNotMatch(JSON.stringify(raw), /private|tokenHash|Prisma|SELECT|orderId/);
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): Database {
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(tx => run(transform(tx)), options);
  } } as unknown as Database;
}

test("服务方汇总契约兼容旧字段；样本数与均分成对，来源和时间格式严格校验", () => {
  assert.deepEqual(ProviderQuery.parse({}), { performanceSource: "live" });
  for (const source of ["mock", "live"]) assert.ok(ProviderQuery.safeParse({ performanceSource: source }).success);
  for (const query of [{ performanceSource: "" }, { performanceSource: "LIVE" }, { providerId: "one" }]) assert.equal(ProviderQuery.safeParse(query).success, false);
  assert.deepEqual(Provider.parse(providers[0]), providers[0]);
  assert.ok(Provider.safeParse({ ...providers[0], performance: null }).success);
  for (const pair of [{ averageRating: null, reviewCount: 0 }, { averageRating: 1, reviewCount: 1 }, { averageRating: 4.67, reviewCount: 3 }]) {
    assert.ok(ProviderPerformance.safeParse({ ...performance, ...pair }).success);
  }
  for (const patch of [{ averageRating: 5 }, { reviewCount: 1 }, { reviewCount: -1 }, { reviewCount: 0.5 },
    { reviewCount: Number.MAX_SAFE_INTEGER + 1 }, { averageRating: 0, reviewCount: 1 }, { averageRating: 5.01, reviewCount: 1 },
    { averageRating: 4.567, reviewCount: 1 }, { averageRating: Infinity, reviewCount: 1 }, { source: "unknown" },
    { basis: "credit_score" }, { calculatedAt: "tomorrow" }, { comments: [] }]) {
    assert.equal(ProviderPerformance.safeParse({ ...performance, ...patch }).success, false, JSON.stringify(patch));
  }
});

test("客户端时钟略慢时，完整 Provider 仍接受未来几秒的计算时间", () => {
  const calculatedAt = new Date(Date.now() + 5000).toISOString();
  const parsed = Provider.parse({ ...providers[0], performance: { ...performance, calculatedAt } });
  assert.equal(parsed.performance?.calculatedAt, calculatedAt);
});

test("公开服务方评价汇总：隔离 SQLite，快照、真实关联校验和来源隔离", async t => {
  const tempRoot = resolve(tmpdir()); const fixture = mkdtempSync(join(tempRoot, "ai-home-D-performance-"));
  const path = join(fixture, "performance.db"); const url = `file:${path.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => {
    await db.$disconnect(); assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-performance-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(path, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 30000,
  });
  await db.user.createMany({ data: ["private-owner", "private-other"].map(id => ({ id, name: "Synthetic", role: "owner" })) });
  await db.serviceProvider.createMany({ data: [...providers, { ...providers[0], id: "outside-directory" }].map(({ tags, availability: _availability, ...provider }) => ({ ...provider, tagsJson: JSON.stringify(tags) })) });
  const cookie = (await db.$transaction(tx => issueOwnerSession({ userId: "private-owner", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  t.beforeEach(async () => {
    await db.review.deleteMany(); await db.serviceOrder.deleteMany(); await db.quote.deleteMany(); await db.demandOrder.deleteMany();
  });
  const add = async (id: string, rating = 4, source: SourceDTO = "live", providerId = "provider-a", status = "completed") => {
    await db.demandOrder.create({ data: { id, ownerId: "private-owner", description: "Synthetic statistics fixture", city: "Test", areaM2: 20,
      budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 10, status } });
    await db.quote.create({ data: { id: `quote-${id}`, demandId: id, providerId, source, status: "accepted",
      itemsJson: "[]", pendingItemsJson: "[]", knownTotalCents: 0, estimatedDays: 10 } });
    await db.serviceOrder.create({ data: { id: `order-${id}`, demandId: id, providerId, acceptedQuoteId: `quote-${id}`, status, source } });
    await db.review.create({ data: { id: `review-${id}`, orderId: `order-${id}`, demandId: id, providerId, source, rating, comment: "private-comment" } });
  };
  const read = (source?: SourceDTO, client: Database = db, credential = "") => handleProviderDirectory(request(source ? `?performanceSource=${source}` : "", credential), client);
  const stat = async (source?: SourceDTO) => (await success(await read(source))).data.find(row => row.id === "provider-a")!.performance!;

  await t.test("默认 live 无样本 null/0，不用种子 rating，匿名与坏 cookie 的公开范围一致", async () => {
    const result = await success(await read());
    for (const row of result.data) {
      assert.deepEqual(row.performance, { ...performance, calculatedAt: row.performance!.calculatedAt });
      assert.equal(row.rating, providers.find(provider => provider.id === row.id)!.rating);
    }
    await success(await read("live", db, "__Host-ai_home_owner_session=invalid"));
    assert.equal((await stat("mock")).source, "mock");
  });

  await t.test("逐服务方均分四舍五入、样本数与来源独立，合法无 live 样本不回退 mock", async () => {
    await add("mock", 1, "mock");
    assert.equal((await stat()).reviewCount, 0);
    await add("one", 5); await add("two", 4); await add("three", 5); await add("other-provider", 2, "live", "provider-b");
    const started = Date.now(); const result = await success(await read()); const a = result.data.find(row => row.id === "provider-a")!;
    assert.equal(a.performance!.averageRating, 4.67); assert.equal(a.performance!.reviewCount, 3);
    assert.equal(result.data.find(row => row.id === "provider-b")!.performance!.averageRating, 2);
    assert.ok(Date.parse(a.performance!.calculatedAt) >= started && Date.parse(a.performance!.calculatedAt) <= Date.now());
    assert.equal((await stat("mock")).averageRating, 1); assert.equal((await stat("mock")).reviewCount, 1);
  });

  await t.test("无绑定旧评价、未完成关系、未公开服务方不进入统计", async () => {
    await add("legacy", 5); await db.review.update({ where: { id: "review-legacy" }, data: { orderId: null, source: "legacy-unknown" } });
    await add("contracted", 5, "live", "provider-a", "contracted");
    await add("active", 5, "live", "provider-a", "in_progress");
    await add("outside", 5, "live", "outside-directory");
    assert.equal((await stat()).reviewCount, 0);
    assert.equal((await success(await read())).data.some(row => row.id === "outside-directory"), false);
  });

  await t.test("通过评价 POST 首次保存和重放只增加一个样本；公开读取不修改业务数据", async () => {
    await add("created", 4, "mock"); await db.review.deleteMany();
    const snapshot = () => db.$transaction(async tx => ({ demands: await tx.demandOrder.findMany(), orders: await tx.serviceOrder.findMany(),
      providers: await tx.serviceProvider.findMany(), quotes: await tx.quote.findMany(), reviews: await tx.review.findMany() }));
    const post = () => handleReviewCreate(new Request(`${origin}/api/review`, { method: "POST", headers: { origin, cookie },
      body: JSON.stringify({ demandId: "created", providerId: "provider-a", rating: 3, comment: "private-comment" }) }), db);
    assert.equal((await post()).status, 201); assert.equal((await post()).status, 200);
    const before = await snapshot();
    const result = await stat("mock"); assert.equal(result.averageRating, 3); assert.equal(result.reviewCount, 1);
    await stat(); assert.deepEqual(await snapshot(), before);
  });

  await t.test("来源或状态不一致、无效评分、报价状态错误均整批 503，另一来源不能掩盖损坏", async () => {
    await add("one");
    for (const change of [
      (tx: Prisma.TransactionClient) => tx.review.update({ where: { id: "review-one" }, data: { source: "mock" } }),
      (tx: Prisma.TransactionClient) => tx.review.update({ where: { id: "review-one" }, data: { rating: 6 } }),
      (tx: Prisma.TransactionClient) => tx.serviceOrder.update({ where: { id: "order-one" }, data: { source: "broken" } }),
      (tx: Prisma.TransactionClient) => tx.quote.update({ where: { id: "quote-one" }, data: { source: "broken" } }),
      (tx: Prisma.TransactionClient) => tx.quote.update({ where: { id: "quote-one" }, data: { status: "submitted" } }),
      (tx: Prisma.TransactionClient) => tx.demandOrder.update({ where: { id: "one" }, data: { status: "in_progress" } }),
    ]) {
      const changed = { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) =>
        db.$transaction(async tx => { await change(tx); return run(tx); }, options) } as unknown as Database;
      for (const source of ["live", "mock"] as const) await denied(await read(source, changed));
    }
    assert.equal((await stat()).reviewCount, 1, "failed validation rolls back injected mutations");
  });

  await t.test("错绑服务方或需求仍被查询捕获，不能通过 SQL 过滤悄悄丢弃", async () => {
    await add("one"); await add("outside", 5, "live", "outside-directory");
    for (const patch of [{ providerId: "outside-directory" }, { demandId: "outside" }, { orderId: "order-outside", providerId: "outside-directory" }]) {
      await db.review.delete({ where: { id: "review-outside" } }).catch(() => {});
      await db.review.update({ where: { id: "review-one" }, data: patch });
      await denied(await read());
      await db.review.update({ where: { id: "review-one" }, data: { providerId: "provider-a", demandId: "one", orderId: "order-one" } });
    }
    await add("demo-demand"); await denied(await read());
  });

  await t.test("输出快照的重复绑定、缺关联、错业主、非法 DTO 不能返回成功汇总", async () => {
    await add("one");
    for (const mutate of [
      (rows: Array<Record<string, unknown>>) => [...rows, ...rows],
      (rows: Array<Record<string, unknown>>) => rows.map(row => ({ ...row, order: null })),
      (rows: Array<Record<string, unknown>>) => rows.map(row => ({ ...row, demand: { ...(row.demand as object), ownerId: "private-other" } })),
      (rows: Array<Record<string, unknown>>) => rows.map(row => ({ ...row, source: undefined })),
    ]) {
      const corrupt = decorate(db, tx => ({ ...tx, review: { ...tx.review, findMany: async (args: Prisma.ReviewFindManyArgs) =>
        mutate(await tx.review.findMany(args) as unknown as Array<Record<string, unknown>>) } }) as unknown as Prisma.TransactionClient);
      await denied(await read("live", corrupt));
    }
  });

  await t.test("参数错误不读库，存储故障不回退 mock/空样本；适配器与 HTTP 同一契约", async () => {
    let calls = 0;
    const broken = { $transaction: async () => { calls++; throw new Error("private database"); } } as unknown as Database;
    for (const query of ["?performanceSource=", "?performanceSource=LIVE", "?performanceSource=mock&performanceSource=live", "?providerId=provider-a", "?source=live"]) {
      await denied(await handleProviderDirectory(request(query), broken), 400, "VALIDATION_ERROR");
    }
    assert.equal(calls, 0); await denied(await read(undefined, broken));
    await assert.rejects(readProviderDirectory({ performanceSource: "live" }, broken), error => error instanceof ProviderDirectoryError && error.code === "PROVIDER_UNAVAILABLE");
    const direct = await readProviderDirectory({ performanceSource: "mock" }, db);
    const http = await success(await read("mock"));
    assert.deepEqual(direct.data.map(row => ({ ...row, performance: { ...row.performance, calculatedAt: "ignored" } })),
      http.data.map(row => ({ ...row, performance: { ...row.performance, calculatedAt: "ignored" } })));
  });
});
