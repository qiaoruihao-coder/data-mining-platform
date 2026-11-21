import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, type SourceDTO } from "../src/contracts";
import { ProviderOrdersContent } from "../src/features/c/ProviderOrders";
import {
  defaultProviderQuoteFilters, filterProviderQuotes, loadProviderOrders, providerOrdersErrorMessage,
  providerQuoteStatusOptions, summarizeProviderOrders, type ProviderOrdersState, type ProviderQuoteFilters,
} from "../src/features/c/provider-orders";

// 合成测试记录，仅用于验证筛选；产品仍读取服务端授权的本人报价。
const records = Quote.array().parse(Quote.shape.status.options.map((status, index) => ({
  id: `Quote-${status}`, demandId: index < 2 ? "需求/A?b#c" : "project-other", providerId: "provider-test",
  status, source: index % 2 ? "mock" : "live", estimatedDays: 5, knownTotalCents: 10001,
  items: [{ code: "repair", name: "维修", unit: "job", quantity: 1, unitPriceCents: null, amountCents: null, note: "待现场确认" }],
  pendingItems: ["待确认材料"],
})));
function payload(data = records, source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: ProviderOrdersState, filters: ProviderQuoteFilters = defaultProviderQuoteFilters) {
  return renderToStaticMarkup(createElement(ProviderOrdersContent, { state, filters, onReload() {}, onFiltersChange() {} }));
}

test("报价状态沿用公共枚举；默认全部，组合筛选不修改记录、来源、费用或顺序", () => {
  const original = structuredClone(records);
  assert.deepEqual(providerQuoteStatusOptions, ["all", ...Quote.shape.status.options]);
  assert.deepEqual(filterProviderQuotes(records, defaultProviderQuoteFilters), records);
  for (const status of Quote.shape.status.options) {
    const result = filterProviderQuotes(records, { status, keyword: " quote- " });
    assert.deepEqual(result.map(quote => quote.status), [status]);
    assert.equal(result[0], records.find(quote => quote.status === status));
  }
  assert.deepEqual(filterProviderQuotes(records, { status: "accepted", keyword: "需求/" }), []);
  assert.deepEqual(records, original);
  assert.deepEqual(summarizeProviderOrders(records), { draft: 1, submitted: 1, accepted: 1, rejected: 1 });
});

test("编号搜索忽略大小写和首尾空白，按字面部分匹配各字段，不搜索服务方或跨字段拼接", () => {
  const select = (keyword: string) => filterProviderQuotes(records, { status: "all", keyword }).map(quote => quote.id);
  assert.deepEqual(select("  QUOTE-SUB  "), ["Quote-submitted"]);
  assert.deepEqual(select("需求/a?B#c"), ["Quote-draft", "Quote-submitted"]);
  assert.deepEqual(select("?b#"), ["Quote-draft", "Quote-submitted"]);
  assert.deepEqual(select("  \t  "), records.map(quote => quote.id));
  for (const keyword of ["provider-test", ".*", "draft需求", "维修", "待确认材料"]) assert.deepEqual(select(keyword), []);
});

test("筛选视图保留全量统计、逐条来源、待定费用与精确需求链接，并显示匹配数量", () => {
  const html = render({ status: "ready", response: payload() }, { status: "draft", keyword: "需求/" });
  for (const text of ["统计全部报价", "刷新保留筛选条件", "显示 1 / 4 条本人报价", "清除报价筛选",
    "含模拟报价", "有，完整总价未确定", "小计不含待确认费用", "100.01"]) assert.ok(html.includes(text), text);
  assert.match(html, /<option value="draft" selected="">草稿报价/);
  assert.match(html, /已保存报价/);
  assert.equal((html.match(/<article\b/g) ?? []).length, 1);
  assert.ok(html.includes(`href="/provider/demand/${encodeURIComponent(records[0].demandId)}"`));
  assert.doesNotMatch(html, /报价编号：Quote-submitted|报价编号：Quote-accepted|报价编号：Quote-rejected/);
  const counts = html.match(/<dl aria-label="本人报价状态数量"[\s\S]*?<\/dl>/)?.[0] ?? "";
  assert.equal((counts.match(/<dd[^>]*>1<\/dd>/g) ?? []).length, 4);
});

test("没有匹配结果与成功空列表区分，空列表仍保留实际来源", () => {
  const filters: ProviderQuoteFilters = { status: "rejected", keyword: "不存在" };
  const noMatch = render({ status: "ready", response: payload() }, filters);
  assert.match(noMatch, /没有符合筛选条件的报价/);
  assert.match(noMatch, /显示 0 \/ 4 条本人报价/);
  assert.doesNotMatch(noMatch, /当前服务方暂无报价记录|<article/);
  for (const source of ["mock", "live"] as const) {
    const empty = render({ status: "ready", response: payload([], source) }, filters);
    assert.match(empty, /当前服务方暂无报价记录/);
    assert.match(empty, /显示 0 \/ 0 条本人报价/);
    assert.ok(empty.includes(source === "mock" ? "含模拟报价" : "已保存报价"));
    assert.doesNotMatch(empty, /没有符合筛选条件的报价|<article/);
  }
});

test("默认控件可通过标签访问，清空后恢复全部；搜索输入作为文本转义", () => {
  const all = render({ status: "ready", response: payload() });
  assert.match(all, /for="provider-quote-status"/);
  assert.match(all, /for="provider-quote-keyword"/);
  assert.match(all, /type="search"/);
  assert.match(all, /<option value="all" selected="">全部报价/);
  assert.match(all, /<button[^>]*disabled=""[^>]*>清除报价筛选/);
  assert.match(all, /显示 4 \/ 4 条本人报价/);
  const html = render({ status: "ready", response: payload() }, { status: "all", keyword: '<script>alert("x")</script>' });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("刷新保留的筛选使用最新返回；本地筛选不发额外请求，不附带身份和搜索参数", async t => {
  let status: "submitted" | "accepted" = "submitted";
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/provider/quotes");
    assert.equal(init, undefined);
    return Response.json(payload([{ ...records[1], status }]));
  });
  const filters: ProviderQuoteFilters = { status: "submitted", keyword: "quote-sub" };
  const first = await loadProviderOrders();
  assert.match(render({ status: "ready", response: first }, filters), /显示 1 \/ 1 条本人报价/);
  for (const status of providerQuoteStatusOptions) render({ status: "ready", response: first }, { ...filters, status });
  assert.equal(fetched.mock.callCount(), 1);
  status = "accepted";
  const next = await loadProviderOrders();
  assert.match(render({ status: "ready", response: next }, filters), /没有符合筛选条件的报价/);
  assert.match(render({ status: "ready", response: next }, defaultProviderQuoteFilters), /显示 1 \/ 1 条本人报价/);
  assert.equal(fetched.mock.callCount(), 2);
});

test("加载或查询失败时不显示旧统计、筛选结果和假空态；501 成功信封也失败", async t => {
  const filters: ProviderQuoteFilters = { status: "submitted", keyword: "quote" };
  const loading = render({ status: "loading" }, filters);
  assert.match(loading, /正在加载/);
  assert.doesNotMatch(loading, /筛选本人报价|显示 \d|本人报价状态数量|<article|没有符合|暂无报价/);
  for (const status of [401, 403, 501, 503]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload(), { status }));
    await assert.rejects(loadProviderOrders(), error => {
      const html = render({ status: "error", message: providerOrdersErrorMessage(error) }, filters);
      assert.match(html, /暂时无法加载本人报价/);
      if (status === 501) assert.match(html, /查询尚未实现/);
      assert.doesNotMatch(html, /筛选本人报价|显示 \d|本人报价状态数量|<article|没有符合|暂无报价/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("未命中筛选的坏记录或重复编号仍拒绝整批，旧 DTO 来源缺失仍显示未知", async t => {
  for (const data of [[...records, records[0]], [...records, { ...records[0], id: "bad", status: "invalid" }]]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ ...payload(), data }));
    await assert.rejects(loadProviderOrders(), error => {
      const html = render({ status: "error", message: providerOrdersErrorMessage(error) }, { status: "submitted", keyword: "Quote-sub" });
      assert.match(html, /数据格式异常/);
      assert.doesNotMatch(html, /<article|显示 \d/);
      return true;
    });
    fetched.mock.restore();
  }
  const html = render({ status: "ready", response: payload([{ ...records[0], source: undefined }]) }, { status: "draft", keyword: "quote" });
  assert.match(html, /报价来源待确认/);
});
