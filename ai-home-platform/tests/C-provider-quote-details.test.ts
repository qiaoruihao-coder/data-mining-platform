import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, type QuoteDTO } from "../src/contracts";
import { ProviderQuoteDetails } from "../src/features/c/ProviderQuoteDetails";
import { ProviderOrdersContent } from "../src/features/c/ProviderOrders";
import { loadProviderOrders, type ProviderOrdersState } from "../src/features/c/provider-orders";

// 仅供测试的合成报价，不作为运行时兜底数据。
const quote = Quote.parse({
  id: "C-details", demandId: "C-demand", providerId: "C-provider", source: "mock", status: "draft",
  items: [
    { code: "free", name: "现场作业", quantity: 1, unit: "job", unitPriceCents: 0, amountCents: 0, note: "免费检查" },
    { code: "measured", name: "现场作业", quantity: 0.145, unit: "m2", unitPriceCents: 100, amountCents: 15, note: "按记录金额核对" },
    { code: "material", name: "材料", quantity: 2, unit: "piece", unitPriceCents: null, amountCents: null, note: "选型后确认\n含运送" },
  ],
  knownTotalCents: 15, pendingItems: ["材料", "材料"], estimatedDays: 3,
});

function render(data: QuoteDTO = quote) {
  return renderToStaticMarkup(createElement(ProviderQuoteDetails, { quote: data }));
}
function renderPage(state: ProviderOrdersState) {
  return renderToStaticMarkup(createElement(ProviderOrdersContent, { state, onReload() {} }));
}
function rows(html: string) {
  const list = html.match(/<ol\b[^>]*>(.*?)<\/ol>/s);
  assert.ok(list);
  return [...list[1].matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((match) => match[1]);
}

test("查询后的四种报价均可查看原始明细，入口默认折叠且可区分报价，保留来源和服务端小计", async (t) => {
  const data = Quote.array().parse(Quote.shape.status.options.map((status) => ({
    ...quote, id: `C-${status}`, status, knownTotalCents: 17,
  })));
  const before = structuredClone(data);
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, "/api/provider/quotes");
    return Response.json({ ok: true, data, meta: { source: "mock" } });
  });
  const response = await loadProviderOrders();
  const html = renderPage({ status: "ready", response });
  assert.equal((html.match(/<details\b/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b|<form|模拟报价已提交|请勿重复提交/);
  // 页面允许搜索框；已保存的报价明细仍不可编辑。
  for (const details of html.matchAll(/<details\b[\s\S]*?<\/details>/g)) {
    assert.doesNotMatch(details[0], /<input|<select|<textarea/);
  }
  for (const { id } of data) {
    assert.ok(html.includes(`报价编号：${id}</span></summary>`));
    assert.ok(html.includes(`aria-label="报价 ${id} 的项目明细"`));
  }
  assert.match(html, /含模拟报价/);
  assert.match(html, /模拟报价/);
  // 显示服务器给出的各金额，不在展示组件以浮点乘法或求和改写结果。
  assert.match(html, /¥0\.17/);
  assert.match(html, /¥0\.15/);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(response.data, before);
});

test("逐行保留同名项目、三种单位、小数数量、零价及多行备注", () => {
  const items = rows(render());
  assert.equal(items.length, 3);
  assert.match(items[0], /现场作业.*项目编号：free.*1 项.*¥0\.00\/项.*¥0\.00.*免费检查/s);
  assert.match(items[1], /现场作业.*项目编号：measured.*0\.145 平方米.*¥1\.00\/平方米.*¥0\.15/s);
  assert.match(items[2], /材料.*项目编号：material.*2 件.*待确认.*待确认.*选型后确认\n含运送/s);
  const duplicateCodes = render({ ...quote, items: [quote.items[0], { ...quote.items[1], code: "free" }] });
  assert.equal(rows(duplicateCodes).length, 2);
});

test("null 单价或金额即使没有待确认事项也不能当零，真实零价可正常显示", () => {
  for (const item of [quote.items[2], { ...quote.items[2], unitPriceCents: 0 }, { ...quote.items[2], amountCents: 0 }]) {
    const html = render({ ...quote, items: [item], pendingItems: [] });
    assert.match(html, /完整总价未确定；未知费用不按零计算/);
    if (item.unitPriceCents === null) assert.match(rows(html)[0], /单价<\/dt><dd[^>]*>待确认/);
    if (item.amountCents === null) assert.match(rows(html)[0], /项目金额<\/dt><dd[^>]*>待确认/);
  }
  const zero = render({ ...quote, items: [quote.items[0]], pendingItems: [] });
  assert.match(zero, /¥0\.00/);
  assert.doesNotMatch(zero, /待确认/);
});

test("空明细不虚构项目，独立待确认事项保留原文和重复项", () => {
  const html = render({ ...quote, items: [], pendingItems: ["待确认项\n需测量", "待确认项\n需测量"] });
  assert.match(html, /报价明细（0 项）/);
  assert.match(html, /接口未提供报价明细，无法逐项核对/);
  assert.doesNotMatch(html, /<ol|现场作业/);
  assert.equal(html.split("待确认项\n需测量").length - 1, 2);
  assert.match(html, /完整总价未确定/);
});

test("安全整数金额末位分不丢失，文本转义且不改变记录", () => {
  const hostile = "<script>synthetic()</script>";
  const data = Quote.parse({ ...quote, id: hostile, items: [{
    ...quote.items[0], name: hostile, code: hostile, note: hostile,
    unitPriceCents: Number.MAX_SAFE_INTEGER, amountCents: Number.MAX_SAFE_INTEGER,
  }], pendingItems: [hostile] });
  const before = structuredClone(data);
  const html = render(data);
  assert.equal(html.split("¥90,071,992,547,409.91").length - 1, 2);
  assert.match(html, /&lt;script&gt;synthetic\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.deepEqual(data, before);
});

test("加载、查询失败和空列表没有残留的报价明细", () => {
  for (const state of [
    { status: "loading" }, { status: "error", message: "登录已失效" },
    { status: "ready", response: { ok: true, data: [], meta: { source: "mock" } } },
  ] satisfies ProviderOrdersState[]) {
    assert.doesNotMatch(renderPage(state), /<details|C-details|现场作业|记录中的待确认事项/);
  }
});
