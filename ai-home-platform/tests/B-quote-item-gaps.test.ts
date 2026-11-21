import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, type QuoteDTO } from "../src/contracts";
import { findQuoteItemGaps } from "../src/lib/quote-engine/item-gaps";
import { prepareQuotes } from "../src/lib/quote-engine";
import { QuoteItemGapWarnings } from "../src/features/b/QuoteItemGapWarnings";
import { QuoteComparison } from "../src/features/b/QuoteComparison";
import { loadQuoteComparison } from "../src/features/b/load-quotes";
import { demoDemand } from "../src/lib/mock-data";

// 合成报价仅用于测试列项差异，不代表真实工程或真实市场价格。
const item = (name: string, amountCents: number | null = 100): QuoteDTO["items"][number] => ({
  code: "line-1", name, unit: "job", quantity: 1, unitPriceCents: amountCents, amountCents, note: "合成测试",
});
const quote = (id: string, items: QuoteDTO["items"], overrides: Partial<QuoteDTO> = {}): QuoteDTO => Quote.parse({
  id, demandId: demoDemand.id, providerId: `provider-${id}`, source: "mock", status: "submitted",
  items, knownTotalCents: 99999, pendingItems: [], estimatedDays: 10, ...overrides,
});

test("两份报价列项不同，分别指出已提及的原始行及未提及的报价", () => {
  const result = findQuoteItemGaps(demoDemand.id, [
    quote("a", [item("防滑施工"), item("垃圾清运")]), quote("b", [item("防滑施工"), item("成品保护")]),
  ]);
  assert.deepEqual(result, [
    { name: "垃圾清运", mentionedIn: [{ quoteId: "a", itemIndexes: [1] }], unmentionedQuoteIds: ["b"] },
    { name: "成品保护", mentionedIn: [{ quoteId: "b", itemIndexes: [1] }], unmentionedQuoteIds: ["a"] },
  ]);
});

test("待确认名称计为已提及，缺少明细时明确区分而不判完全缺项", () => {
  const values = [quote("a", [item("垃圾清运", null)]), quote("b", [], { pendingItems: [" 垃圾清运 ", "垃圾清运"] })];
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, values), []);
  const [gap] = findQuoteItemGaps(demoDemand.id, [...values, quote("c", [])]);
  assert.deepEqual(gap.mentionedIn, [{ quoteId: "a", itemIndexes: [0] }, { quoteId: "b", itemIndexes: [] }]);
  assert.deepEqual(gap.unmentionedQuoteIds, ["c"]);
  const html = renderToStaticMarkup(createElement(QuoteItemGapWarnings, { demandId: demoDemand.id, quotes: [...values, quote("c", [])] }));
  assert.ok(html.includes("仅列于待确认项目，尚无同名明细"));
});

test("同名待确认与零元项目均为已提及，不按金额或单位判断缺项且不修改输入", () => {
  const values = [quote("a", [item("施工", null)]), quote("b", [{ ...item("施工", 0), unit: "m2" }])];
  const before = structuredClone(values);
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, values), []);
  const [gap] = findQuoteItemGaps(demoDemand.id, [...values, quote("c", [])]);
  assert.deepEqual(gap.unmentionedQuoteIds, ["c"]);
  assert.deepEqual(values, before);
});

test("重复编号和同名多行保留行位置，但每个名称只提示一次", () => {
  const values = [quote("a", [item("清运"), item(" 清运 "), item("测量")], { pendingItems: ["清运", "清运"] }), quote("b", [])];
  const gaps = findQuoteItemGaps(demoDemand.id, values);
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps[0].mentionedIn, [{ quoteId: "a", itemIndexes: [0, 1] }]);
  const html = renderToStaticMarkup(createElement(QuoteItemGapWarnings, { demandId: demoDemand.id, quotes: values }));
  assert.ok(html.includes("明细第 1、2 行"));
});

test("只按名称去除首尾空白精确比较，同编号不同名不混淆且不猜同义词", () => {
  const values = [quote("a", [item("垃圾清运")]), quote("b", [item("垃圾 清运"), item("清理垃圾")])];
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, values).map(gap => gap.name), ["垃圾清运", "垃圾 清运", "清理垃圾"]);
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, [values[0], quote("c", [item(" 垃圾清运 ")])]), []);
});

test("异需求、草稿和拒绝报价不加入参照清单，已接受报价参与核对", () => {
  const values = [quote("a", [item("施工")]), quote("b", [item("施工")], { status: "accepted" }),
    quote("other", [item("外部项目")], { demandId: "other" }), quote("draft", [item("草稿项目")], { status: "draft" }),
    quote("rejected", [], { status: "rejected" })];
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, values), []);
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, [values[0], { ...values[1], items: [] }])[0].unmentionedQuoteIds, ["b"]);
});

test("空列表、单份报价和全空白名称不制造差异；空明细报价不会被当成免费", () => {
  for (const values of [[], [quote("a", [item("施工")])], [quote("a", [item(" ")]), quote("b", [], { pendingItems: ["", " "] })]]) {
    assert.deepEqual(findQuoteItemGaps(demoDemand.id, values), []);
    assert.equal(renderToStaticMarkup(createElement(QuoteItemGapWarnings, { demandId: demoDemand.id, quotes: values })), "");
  }
  const html = renderToStaticMarkup(createElement(QuoteItemGapWarnings, { demandId: demoDemand.id, quotes: [quote("a", [item("施工")]), quote("b", [])] }));
  assert.ok(html.includes("未提及不代表漏报或免费"));
  assert.ok(html.includes("未出现提醒也不代表覆盖完整需求"));
  assert.ok(!html.includes("¥0.00"));
});

test("名称只在待确认列表出现仍可作为核对线索，重算合计前后结果稳定", () => {
  const values = [quote("a", [item("施工", null)], { pendingItems: ["现场增项", "现场增项"] }), quote("b", [item("施工", 0)])];
  const before = findQuoteItemGaps(demoDemand.id, values);
  assert.deepEqual(before, [{ name: "现场增项", mentionedIn: [{ quoteId: "a", itemIndexes: [] }], unmentionedQuoteIds: ["b"] }]);
  assert.deepEqual(findQuoteItemGaps(demoDemand.id, prepareQuotes(demoDemand.id, values)), before);
});

test("读取到报价页接线保留 mock、未知与零元，只提示核对而不添加缺项金额", async t => {
  const values = [quote("a", [item("垃圾清运", null), item("现场测量", 0)]), quote("b", [item("现场测量", 0)])];
  t.mock.method(globalThis, "fetch", async (url: string) => Response.json({
    ok: true, data: url.startsWith("/api/quote?") ? values : url === "/api/provider" ? [] : demoDemand, meta: { source: "mock" },
  }));
  const data = await loadQuoteComparison(demoDemand.id);
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data }));
  assert.ok(html.includes("报价列项差异 · 1 项待核对"));
  assert.ok(html.indexOf("报价列项差异") < html.indexOf("<table"));
  for (const text of ["mock · 模拟报价", "待确认", "¥0.00", "不补零、不调整合计", "数据来源见下方逐份报价标识"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("¥999.99"));
  assert.deepEqual(data.response.data.map(value => value.items.map(row => row.amountCents)), [[null, 0], [0]]);
  assert.equal(data.response.data[1].items.length, 1);
});
