import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { Quote, QuoteSubmissionInput, envelope, type QuoteDTO, type SourceDTO } from "../src/contracts";
import { quotes } from "../src/lib/mock-data";
import { parseStoredQuoteSource, summarizeQuoteSources } from "../src/lib/quote-policy";
import { createDemoSessionHandlers } from "../src/lib/demo-session-handlers";
import { readDemoVerifiedSession } from "../src/lib/server-auth";
import { handleQuoteSubmission } from "../src/lib/quote-engine/submit-request";

const input = QuoteSubmissionInput.parse({ demandId: "source-demand", estimatedDays: 3,
  items: [{ code: "test", name: "合成报价", unit: "job", quantity: 1, unitPriceCents: null, note: "测试数据" }] });

test("Quote 兼容缺省来源，但非法来源和客户端提交来源均被公共契约拒绝", () => {
  const legacy = { ...quotes[0] };
  delete legacy.source;
  assert.equal(Quote.parse(legacy).source, undefined);
  for (const source of ["mock", "live"] as const) {
    assert.equal(Quote.parse({ ...legacy, source }).source, source);
    assert.equal(QuoteSubmissionInput.safeParse({ ...input, source }).success, false);
  }
  for (const source of [null, "", "LIVE", "unknown", 1, {}, { source: "live" }]) {
    assert.equal(Quote.safeParse({ ...legacy, source }).success, false);
  }
  assert.equal(QuoteSubmissionInput.safeParse({ ...input, meta: { source: "live" } }).success, false);
});

test("持久化来源校验不使用 DTO 可选规则，缺失和损坏均抛错", () => {
  for (const source of ["mock", "live"]) assert.equal(parseStoredQuoteSource(source), source);
  for (const source of [undefined, null, "", " live ", "LIVE", "unknown", 0, false, {}, ["live"]]) {
    assert.throws(() => parseStoredQuoteSource(source), ZodError);
  }
});

test("来源汇总涵盖全 live、混合、兼容缺省和空列表，且不改变逐条来源", () => {
  const cases: [SourceDTO | undefined, (SourceDTO | undefined)[], SourceDTO][] = [
    ["live", ["live", "live"], "live"], ["live", ["mock", "live"], "mock"],
    ["live", ["live", "mock"], "mock"], ["live", [undefined], "mock"],
    ["mock", ["live"], "mock"], [undefined, ["live"], "mock"],
    ["live", [], "live"], ["mock", [], "mock"], [undefined, [], "mock"],
  ];
  for (const [demandSource, sources, expected] of cases) {
    const rows = Object.freeze(sources.map(source => Object.freeze({ source })));
    assert.equal(summarizeQuoteSources(demandSource, rows), expected);
    assert.deepEqual(rows.map(row => row.source), sources);
  }
});

test("mock 需求或前序 mock 报价不能掩盖后续非法来源", () => {
  for (const invalid of [null, "", "bad", 1]) {
    const broken = { source: invalid } as unknown as Pick<QuoteDTO, "source">;
    assert.throws(() => summarizeQuoteSources("mock", [broken]), ZodError);
    assert.throws(() => summarizeQuoteSources("live", [{ source: "mock" }, broken]), ZodError);
    assert.throws(() => summarizeQuoteSources(invalid as SourceDTO, []), ZodError);
  }
  for (const malformed of [[null], [undefined], new Array(1)]) {
    assert.throws(() => summarizeQuoteSources("live", malformed as Pick<QuoteDTO, "source">[]), ZodError);
  }
});

test("固定演示报价逐条声明 mock", () => {
  assert.ok(quotes.length > 0);
  assert.ok(quotes.every(quote => quote.source === "mock"));
  assert.equal(summarizeQuoteSources("live", quotes), "mock");
});

test("隔离 SQLite 从无 source 的旧表升级，保留历史报价、回执和关联", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-quote-source-"));
  const databasePath = join(fixture, "source.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDemo = process.env.DEMO_AUTH_ENABLED;
  t.after(async () => {
    if (previousDemo === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemo;
    await db.$disconnect();
    const target = resolve(fixture);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith("ai-home-D-quote-source-"));
    rmSync(target, { recursive: true, force: true });
  });
  const schema = resolve("prisma/schema.prisma");
  const current = readFileSync(schema, "utf8");
  const quoteModel = current.match(/model Quote \{[\s\S]*?\n\}/)![0];
  const legacyQuoteModel = quoteModel.replace(/^\s*source String @default\("mock"\)\r?\n/m, "");
  assert.notEqual(legacyQuoteModel, quoteModel);
  const legacySchema = join(fixture, "legacy.prisma");
  writeFileSync(legacySchema, current.replace(quoteModel, legacyQuoteModel));
  writeFileSync(databasePath, "");
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const push = (path: string) => execFileSync(process.execPath,
    [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", path, "--skip-generate"],
    { env, stdio: "pipe", timeout: 30000 });
  const seed = () => execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"],
    { env, stdio: "pipe", timeout: 30000 });
  push(legacySchema);
  const oldColumns = await db.$queryRaw<{ name: string }[]>`PRAGMA table_info("Quote")`;
  assert.equal(oldColumns.some(column => column.name === "source"), false);
  await db.user.create({ data: { id: "source-owner", name: "合成业主", role: "owner" } });
  await db.serviceProvider.create({ data: { id: "source-provider", name: "合成服务方", city: "测试", kind: "construction", tagsJson: "[]" } });
  const demand = { ownerId: "source-owner", description: "合成需求", city: "测试", areaM2: 10,
    budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 3, status: "published" };
  await db.demandOrder.createMany({ data: [{ ...demand, id: input.demandId }, { ...demand, id: "demo-demand" }] });
  for (const [id, demandId] of [["legacy-live-demand", input.demandId], ["legacy-demo-demand", "demo-demand"]]) {
    await db.$executeRaw`INSERT INTO "Quote" ("id", "demandId", "providerId", "itemsJson", "knownTotalCents", "pendingItemsJson", "estimatedDays", "status")
      VALUES (${id}, ${demandId}, ${"source-provider"}, ${JSON.stringify(quotes[0].items)}, ${1200000}, ${JSON.stringify(quotes[0].pendingItems)}, ${3}, ${"submitted"})`;
    await db.quoteSubmissionReceipt.create({ data: { id: `receipt-${id}`, providerId: "source-provider",
      quoteId: id, idempotencyKey: `key-${id}`, requestHash: `hash-${id}` } });
  }
  const before = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Quote" ORDER BY "id"`;
  const receiptsBefore = await db.quoteSubmissionReceipt.findMany({ orderBy: { id: "asc" } });

  await t.test("普通 db push 回填历史为 mock，所有原字段、回执与外键保持不变", async () => {
    await db.$disconnect();
    push(schema);
    const rows = await db.quote.findMany({ orderBy: { id: "asc" }, include: { submissionReceipt: true } });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.source, "mock");
      assert.equal(row.submissionReceipt?.quoteId, row.id);
      assert.equal(parseStoredQuoteSource(row.source), "mock");
    }
    // raw 查询保持 SQLite 数字类型一致，逐字段核对旧内容。
    const after = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Quote" ORDER BY "id"`;
    assert.deepEqual(after.map(row => { const copy = { ...row }; delete copy.source; return copy; }), before);
    assert.deepEqual(await db.quoteSubmissionReceipt.findMany({ orderBy: { id: "asc" } }), receiptsBefore);
    assert.deepEqual(await db.$queryRaw`PRAGMA foreign_key_check`, []);
    const columns = await db.$queryRaw<{ name: string; notnull: bigint; dflt_value: string }[]>`PRAGMA table_info("Quote")`;
    const sourceColumn = columns.find(column => column.name === "source")!;
    assert.equal(Number(sourceColumn.notnull), 1);
    assert.equal(sourceColumn.dflt_value, "'mock'");
  });

  await t.test("新记录默认 mock；重复同步及 seed 不覆盖明确来源或已有历史记录", async () => {
    const data = { demandId: input.demandId, providerId: "source-provider", itemsJson: "[]",
      pendingItemsJson: "[]", knownTotalCents: 0, estimatedDays: 3, status: "submitted" };
    const defaulted = await db.quote.create({ data: { ...data, id: "default-source" } });
    assert.equal(defaulted.source, "mock");
    // 合成存储夹具验证 live 可保留，不代表已交付生产认证。
    await db.quote.create({ data: { ...data, id: "explicit-source", source: parseStoredQuoteSource("live") } });
    await assert.rejects(db.$executeRaw`UPDATE "Quote" SET "source" = NULL WHERE "id" = ${defaulted.id}`);
    const beforeSync = await db.quote.findMany({ orderBy: { id: "asc" } });
    await db.$disconnect();
    push(schema);
    assert.deepEqual(await db.quote.findMany({ orderBy: { id: "asc" } }), beforeSync);
    seed();
    seed();
    for (const saved of beforeSync) assert.deepEqual(await db.quote.findUniqueOrThrow({ where: { id: saved.id } }), saved);
    for (const mock of quotes) assert.equal((await db.quote.findUniqueOrThrow({ where: { id: mock.id } })).source, "mock");
    assert.deepEqual(await db.quoteSubmissionReceipt.findMany({ orderBy: { id: "asc" } }), receiptsBefore);
    assert.deepEqual(await db.$queryRaw`PRAGMA foreign_key_check`, []);
  });

  await t.test("真实演示 cookie 报价落库为 mock，重连重放保留来源，客户端不能指定 live", async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    const origin = "http://localhost:3000";
    const login = await createDemoSessionHandlers(db).POST(new Request(`${origin}/api/auth/demo-provider`, {
      method: "POST", headers: { origin }, body: JSON.stringify({ action: "login_demo" }),
    }));
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const req = (body: unknown = input) => new Request(`${origin}/api/quote`, { method: "POST",
      headers: { origin, cookie, "content-type": "application/json", "Idempotency-Key": "source-demo-quote-key" }, body: JSON.stringify(body) });
    const auth = { readSession: (request: Request) => readDemoVerifiedSession(request, db), readTransactionSession: readDemoVerifiedSession };
    const counts = [await db.quote.count(), await db.quoteSubmissionReceipt.count()];
    const created = await handleQuoteSubmission(req(), auth, db);
    assert.equal(created.status, 201);
    const first = envelope(Quote).parse(await created.json());
    assert.equal(first.meta.source, "mock");
    const persisted = await db.quote.findUniqueOrThrow({ where: { id: first.data.id } });
    assert.equal(persisted.source, "mock");
    assert.equal(summarizeQuoteSources("live", [{ source: parseStoredQuoteSource(persisted.source) }]), "mock");
    await db.$disconnect();
    const replayed = await handleQuoteSubmission(req(), auth, db);
    assert.equal(replayed.status, 200);
    assert.deepEqual(envelope(Quote).parse(await replayed.json()), first);
    const receipt = await db.quoteSubmissionReceipt.findUniqueOrThrow({ where: { quoteId: first.data.id }, include: { quote: true } });
    assert.equal(receipt.quote.source, "mock");
    assert.equal((await handleQuoteSubmission(req({ ...input, source: "live" }), auth, db)).status, 400);
    assert.deepEqual([await db.quote.count(), await db.quoteSubmissionReceipt.count()], counts.map(count => count + 1));
  });

  await t.test("SQLite 非法字符串不被读取工具降级为 mock", async () => {
    await db.$executeRaw`UPDATE "Quote" SET "source" = ${"invalid-source"} WHERE "id" = ${"explicit-source"}`;
    const broken = await db.quote.findUniqueOrThrow({ where: { id: "explicit-source" } });
    assert.throws(() => parseStoredQuoteSource(broken.source), ZodError);
  });
});
