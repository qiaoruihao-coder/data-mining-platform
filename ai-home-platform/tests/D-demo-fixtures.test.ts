import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, Provider, Quote, envelope } from "../src/contracts";
import { demoCompletedDemands, demoCompletedQuotes, demoDemand, quotes } from "../src/lib/mock-data";
import { demandItemSource } from "../src/lib/demand";
import { handleDemandDetail, handleDemandList } from "../src/lib/demand-read";
import { issueOwnerSession } from "../src/lib/owner-auth";
import { handleProviderDirectory } from "../src/lib/provider-directory";
import { matchProviders } from "../src/lib/match";
import { loadQuoteData } from "../src/lib/quote-engine/data";
import { QuoteComparison } from "../src/features/b/QuoteComparison";

test("固定报价在既有页面同时展示单位、未提及与待确认提醒，金额仍一致", () => {
  const data = loadQuoteData()!;
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data: {
    ...data, demandSource: "mock", quoteSource: "mock", providerSource: "mock",
  } }));
  for (const text of ["同名项目计价单位不一致", "防滑地面", "平方米（㎡）", "报价列项差异", "成品保护",
    "未提及：报价", "待确认项目", "垃圾清运", "mock · 模拟报价", "¥12,000.00", "¥13,000.00"]) {
    assert.ok(html.includes(text), text);
  }
  assert.equal(quotes[0].items.find(item => item.code === "haul")!.amountCents, null);
  for (const quote of [...quotes, ...demoCompletedQuotes]) {
    assert.equal(quote.source, "mock");
    assert.equal(quote.items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0), quote.knownTotalCents);
  }
});

test("实际重复 seed 产生可查询的 mock 档期/评价样本，保持来源、隐私和已有记录", async t => {
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-demo-fixtures-"));
  const url = `file:${join(fixture, "demo.db").replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => {
    await db.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot);
    assert.ok(basename(fixture).startsWith("ai-home-D-demo-fixtures-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  const env = { ...process.env, DATABASE_URL: url };
  writeFileSync(join(fixture, "demo.db"), "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"],
    { env, stdio: "pipe", timeout: 30000 });
  const seed = () => execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"],
    { env, stdio: "pipe", timeout: 30000 });
  seed();
  // An existing fixed quote must survive re-seeding, even when its stored note differs.
  const original = await db.quote.findUniqueOrThrow({ where: { id: "quote-a" } });
  const items = Quote.shape.items.parse(JSON.parse(original.itemsJson));
  items[0].note = "保留既有演示备注";
  await db.quote.update({ where: { id: original.id }, data: { itemsJson: JSON.stringify(items) } });
  seed();
  assert.equal((await db.quote.findUniqueOrThrow({ where: { id: original.id } })).itemsJson, JSON.stringify(items));
  assert.equal(await db.serviceOrder.count(), 4);
  assert.equal(await db.review.count(), 4);
  const read = async (query = "") => {
    const response = await handleProviderDirectory(new Request(`https://localhost/api/provider${query}`), db);
    assert.equal(response.status, 200);
    const raw = await response.json();
    assert.doesNotMatch(JSON.stringify(raw), /comment|ownerId|demandId|orderId|acceptedQuoteId|demo-completed/);
    return envelope(Provider.array()).parse(raw);
  };
  const mock = await read("?performanceSource=mock");
  assert.equal(mock.meta.source, "mock");
  const a = mock.data.find(provider => provider.id === "provider-a")!;
  const b = mock.data.find(provider => provider.id === "provider-b")!;
  assert.equal(a.performance!.averageRating, 4.67);
  assert.equal(a.performance!.reviewCount, 3);
  assert.equal(b.performance!.averageRating, 4);
  assert.equal(b.performance!.reviewCount, 1);
  assert.ok(mock.data.every(provider => provider.performance!.source === "mock"));
  assert.equal(a.availability!.source, "mock");
  assert.deepEqual(a.availability!.windows, [
    { startDate: "2026-11-18", endDate: "2026-11-30" },
    { startDate: "2026-12-05", endDate: "2026-12-20" },
  ]);
  assert.equal(b.availability!.source, "mock");
  assert.deepEqual(b.availability!.windows, [{ startDate: "2026-11-20", endDate: "2026-12-20" }]);
  const now = Date.parse("2026-11-15T04:00:00Z");
  assert.deepEqual(matchProviders(demoDemand, mock.data, now).map(row => [row.provider.id, row.score]),
    [["provider-a", 98], ["provider-b", 98]]);
  for (const query of ["", "?performanceSource=live"]) {
    const live = await read(query);
    assert.ok(live.data.every(provider => provider.performance!.source === "live"
      && provider.performance!.averageRating === null && provider.performance!.reviewCount === 0));
    assert.deepEqual(matchProviders(demoDemand, live.data, now).map(row => [row.provider.id, row.score]),
      [["provider-b", 98], ["provider-a", 98]]);
  }
  // Use a trusted session fixture only to exercise authorized demand DTO/envelope reads.
  const cookie = (await db.$transaction(tx => issueOwnerSession({ userId: "demo-owner", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const request = (path: string) => new Request(`https://localhost${path}`, { headers: { cookie } });
  for (const demand of demoCompletedDemands) {
    const response = await handleDemandDetail(request(`/api/demand/${demand.id}`), demand.id, db);
    assert.equal(response.status, 200);
    const body = envelope(Demand).parse(await response.json());
    assert.equal(body.data.source, "mock"); assert.equal(body.meta.source, "mock");
    const anonymous = await handleDemandDetail(new Request(`https://localhost/api/demand/${demand.id}`), demand.id, db);
    assert.equal(anonymous.status, 404, "completed fixtures do not become public demands");
  }
  const list = await handleDemandList(request("/api/demand"), db);
  assert.equal(list.status, 200);
  const body = envelope(Demand.array()).parse(await list.json());
  assert.equal(body.meta.source, "mock");
  assert.ok(body.data.every(demand => demand.source === "mock"));
  assert.equal(demandItemSource("demo-completed-a-other"), "live", "only exact reserved fixture IDs are mock");
});
