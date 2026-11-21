import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderDTO, ProviderPerformanceDTO } from "../src/contracts";
import { demoDemand } from "../src/lib/mock-data";
import { installMatchProtocolFixture } from "./B-match-fixtures";
import { matchProviders } from "../src/lib/match";
import { ProviderCard } from "../src/components/ProviderCard";
import { prisma } from "../src/lib/prisma";
import { handleProviderDirectory } from "../src/lib/provider-directory";
import { GET } from "../src/app/api/match/route";
import { loadMatches } from "../src/features/b/load-matches";

const performance = (averageRating: number | null, reviewCount = averageRating === null ? 0 : 3, source: "mock" | "live" = "live"): ProviderPerformanceDTO => ({
  basis: "completed_order_review_average", averageRating, reviewCount, source, calculatedAt: "2030-01-01T00:00:00Z",
});
const provider = (id: string, value: ProviderDTO["performance"], extra: Partial<ProviderDTO> = {}): ProviderDTO => ({
  id, name: id, city: demoDemand.city, kind: "construction", tags: ["适老化"], rating: 4.5, source: "mock", performance: value, ...extra,
});
const ids = (rows: ProviderDTO[]) => matchProviders(demoDemand, rows).map(row => row.provider.id);

test("评价仅在基础同分组内降序，不改基础分，不按样本数加分", () => {
  const rows = [provider("a", performance(4.2, 100)), provider("b", performance(4.9, 1)), provider("c", performance(5), { rating: 4 }), provider("d", performance(1), { rating: 5 })];
  const result = matchProviders(demoDemand, rows);
  assert.deepEqual(result.map(row => [row.provider.id, row.score]), [["d", 100], ["b", 96], ["a", 96], ["c", 92]]);
  assert.match(result[1].reasons.at(-1)!, /数据完整且来源一致/);
  assert.deepEqual(ids([provider("b", performance(4.2, 100)), provider("a", performance(4.2, 1))]), ["a", "b"]);
});

test("任一缺失/null/零样本/非法评价让整个同分组退回 ID，未知不淘汰", () => {
  for (const value of [undefined, null, performance(null), { ...performance(5), reviewCount: 0 }]) {
    const rows = [provider("c", performance(5)), provider("a", value), provider("b", performance(4))];
    assert.deepEqual(ids(rows), ["a", "b", "c"]);
    assert.ok(matchProviders(demoDemand, rows).every(row => row.reasons.at(-1)?.includes("整组不使用评价")));
  }
});

test("mixed mock/live 不混排，同源 mock 可细排；缺失仅影响自己的同分组", () => {
  assert.deepEqual(ids([provider("b", performance(5)), provider("a", performance(2, 3, "mock"))]), ["a", "b"]);
  assert.deepEqual(ids([provider("b", performance(5, 1, "mock")), provider("a", performance(2, 3, "mock"))]), ["b", "a"]);
  assert.deepEqual(ids([provider("c", null, { rating: 4 }), provider("a", performance(2)), provider("b", performance(5))]), ["b", "a", "c"]);
});

function permutations<T>(rows: T[]): T[][] {
  return rows.length ? rows.flatMap((row, index) => permutations(rows.filter((_, i) => i !== index)).map(rest => [row, ...rest])) : [[]];
}
test("全排列保持相同顺序，混合缺失不产生循环比较且输入不被修改", () => {
  for (const middle of [performance(4), performance(null), performance(4, 2, "mock")]) {
    const rows = [provider("a", performance(3)), provider("b", middle), provider("c", performance(5)), provider("d", performance(5))];
    const before = structuredClone(rows);
    const expected = ids(rows);
    for (const permutation of permutations(rows)) assert.deepEqual(ids(permutation), expected);
    assert.deepEqual(rows, before);
  }
});

test("硬过滤先执行：异地与错误工种的缺失评价不能阻止合格组细排", () => {
  assert.deepEqual(ids([provider("a", performance(2)), provider("b", performance(5)), provider("remote", null, { city: "异地" }), provider("design", null, { kind: "design" })]), ["b", "a"]);
});

test("卡片区分旧评分、评价均分、未知/无样本及来源；0/1/2 提示样本少，3 不提示", () => {
  for (const count of [0, 1, 2, 3]) {
    const [match] = matchProviders(demoDemand, [provider("a", performance(count ? 4.25 : null, count))]);
    const html = renderToStaticMarkup(createElement(ProviderCard, { match, rank: 1 }));
    assert.equal(html.includes("样本少"), count < 3);
    assert.match(html, /基础资料评分 4.5/);
    assert.match(html, /mock · 模拟资料/);
    assert.match(html, /live · 已保存的接单评价/);
    assert.match(html, /2030-01-01T00:00:00Z/); // 浏览器时钟差异不拒绝合法服务端时间。
    assert.ok(html.includes(count ? "评价均分 4.25/5" : "暂无评价"));
    assert.doesNotMatch(html, /评价均分 0/);
  }
  const [match] = matchProviders(demoDemand, [provider("a", undefined)]);
  assert.match(renderToStaticMarkup(createElement(ProviderCard, { match, rank: 1 })), /暂无评价汇总/);
});

test("浏览器与匹配 API 使用共享目录默认 live 汇总，mock 样本不补齐，读取失败不回退", async t => {
  installMatchProtocolFixture(t);
  const transaction = prisma.$transaction;
  const sample = (id: string, providerId: string, source: "mock" | "live", rating: number) => ({
    id, orderId: `order-${id}`, demandId: `demand-${id}`, providerId, rating, source,
    demand: { id: `demand-${id}`, ownerId: "synthetic-owner", status: "completed" },
    order: { id: `order-${id}`, demandId: `demand-${id}`, providerId, acceptedQuoteId: `quote-${id}`, status: "completed", source,
      demand: { id: `demand-${id}`, ownerId: "synthetic-owner", status: "completed" },
      acceptedQuote: { id: `quote-${id}`, demandId: `demand-${id}`, providerId, status: "accepted", source } },
  });
  let fail = false;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => {
    if (fail) throw Error("synthetic database failure");
    return run({ review: { findMany: async () => [sample("live-one", "fixture-a", "live", 4), sample("mock-one", "fixture-b", "mock", 5)] } });
  }) as typeof transaction;
  t.after(() => { prisma.$transaction = transaction; });
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (path: string) => {
    urls.push(path);
    return path === "/api/provider" ? handleProviderDirectory(new Request("http://localhost/api/provider"))
      : Response.json({ ok: true, data: demoDemand, meta: { source: "mock" } });
  });
  const http = await GET(new Request("http://localhost/api/match"));
  assert.equal(http.status, 200);
  assert.equal(http.headers.get("cache-control"), "private, no-store");
  assert.equal(http.headers.get("vary"), "Cookie");
  const api = await http.json();
  const browser = await loadMatches(demoDemand.id);
  const comparable = (rows: typeof browser.response.data) => rows.map(row => ({ id: row.provider.id, score: row.score, reasons: row.reasons, performance: { ...row.provider.performance, calculatedAt: "snapshot" } }));
  assert.deepEqual(comparable(api.data), comparable(browser.response.data));
  assert.deepEqual(browser.response.data.map(row => row.provider.id), ["fixture-a", "fixture-b"]);
  assert.equal(browser.response.data[0].provider.performance?.averageRating, 4);
  assert.equal(browser.response.data[1].provider.performance?.averageRating, null);
  assert.equal(browser.response.data[1].provider.performance?.source, "live");
  assert.deepEqual(urls, ["/api/demand/demo-demand", "/api/provider"]);
  fail = true;
  const failure = await GET(new Request("http://localhost/api/match"));
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).error.code, "PROVIDER_UNAVAILABLE");
  await assert.rejects(loadMatches(demoDemand.id));
});
