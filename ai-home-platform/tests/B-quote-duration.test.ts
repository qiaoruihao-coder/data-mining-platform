import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, Quote } from "../src/contracts";
import { compareQuoteDuration } from "../src/lib/quote-engine/duration";
import { QuoteDurationSummary } from "../src/features/b/QuoteDurationSummary";
import { QuoteComparison } from "../src/features/b/QuoteComparison";
import { QuoteTable } from "../src/components/QuoteTable";
import { loadQuoteData } from "../src/lib/quote-engine/data";

// 合成夹具，不代表服务方真实档期或履约承诺。
const demand = Demand.parse({ id: "duration-demand", description: "测试需求", city: "测试城市", areaM2: 10,
  budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 30, status: "published", source: "mock" });
const quote = Quote.parse({ id: "duration-quote", demandId: demand.id, providerId: "test-provider", estimatedDays: 25,
  status: "submitted", items: [], knownTotalCents: 0, pendingItems: [] });
const render = (desiredDays: number, estimatedDays: number) => renderToStaticMarkup(createElement(QuoteDurationSummary, {
  demand: { ...demand, desiredDays }, quote: { ...quote, estimatedDays },
}));

test("预计工期短于、等于、长于需求均给出准确天数差，输入保持不变", () => {
  for (const [estimatedDays, position, differenceDays] of [[29, "shorter", 1], [30, "equal", 0], [31, "longer", 1], [1, "shorter", 29]] as const) {
    const value = { ...quote, estimatedDays };
    const before = structuredClone({ demand, value });
    assert.deepEqual(compareQuoteDuration(demand, value), { position, differenceDays });
    assert.deepEqual({ demand, value }, before);
  }
});

test("工期仅对照当前需求，缺失需求上下文或空列表不生成对照", () => {
  const other = { ...demand, id: "other-demand" };
  assert.equal(compareQuoteDuration(other, quote), null);
  assert.equal(renderToStaticMarkup(createElement(QuoteDurationSummary, { demand: other, quote })), "");
  for (const props of [{ quotes: [quote] }, { quotes: [], demand }, { quotes: [quote], demand: other }]) {
    assert.ok(!renderToStaticMarkup(createElement(QuoteTable, props)).includes("与期望工期对照"));
  }
});

test("安全整数边界保留一天差额，不将零、负数、小数、非有限或不安全数值解释为工期优势", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(compareQuoteDuration({ ...demand, desiredDays: maximum }, { ...quote, estimatedDays: maximum - 1 }), { position: "shorter", differenceDays: 1 });
  assert.deepEqual(compareQuoteDuration({ ...demand, desiredDays: maximum - 1 }, { ...quote, estimatedDays: maximum }), { position: "longer", differenceDays: 1 });
  assert.deepEqual(compareQuoteDuration({ ...demand, desiredDays: 1 }, { ...quote, estimatedDays: maximum }), { position: "longer", differenceDays: maximum - 1 });
  for (const invalid of [0, -1, 1.5, NaN, Infinity, -Infinity, maximum + 1]) {
    for (const [desiredDays, estimatedDays] of [[invalid, 30], [30, invalid]]) {
      assert.deepEqual(compareQuoteDuration({ ...demand, desiredDays }, { ...quote, estimatedDays }), { position: "unavailable", differenceDays: null });
      const html = render(desiredDays, estimatedDays);
      assert.ok(html.includes("工期天数无法可靠比较"));
      assert.ok(!html.includes("需求期望："));
      assert.ok(!html.includes("比需求期望短"));
      assert.ok(!html.includes("比需求期望长"));
    }
  }
});

test("三种工期结论均显示比较依据及档期限制，不生成开工或完工日期", () => {
  for (const [estimated, message] of [[25, "比需求期望短 5 天"], [30, "与需求期望天数相同"], [35, "比需求期望长 5 天，请确认能否调整"]] as const) {
    const html = render(30, estimated);
    assert.ok(html.includes(message));
    assert.match(html, /需求期望：30 天 · 报价预计：\d+ 天/);
    assert.ok(html.includes("不代表可立即开工、档期已确认或承诺按期完工"));
    assert.ok(html.includes("施工范围和起止日期仍需双方确认"));
    assert.ok(!html.includes("<time"));
  }
});

test("报价页逐份展示工期差异，保留原顺序、模拟来源和待确认费用", () => {
  const data = loadQuoteData();
  assert.ok(data);
  const before = structuredClone(data);
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data: {
    ...data, demandSource: "mock", quoteSource: "mock", providerSource: "mock",
  } }));
  assert.equal((html.match(/aria-label="与期望工期对照"/g) ?? []).length, 2);
  assert.ok(html.includes("比需求期望短 5 天"));
  assert.ok(html.includes("比需求期望短 2 天"));
  assert.ok(html.indexOf("报价编号：quote-a") < html.indexOf("报价编号：quote-b"));
  assert.ok(html.includes("mock · 模拟报价，不代表真实市场报价"));
  assert.ok(html.includes("垃圾清运"));
  assert.ok(html.includes("待确认项目 · 1 项"));
  assert.ok(html.includes("¥12,000.00"));
  assert.ok(html.includes("¥13,000.00"));
  assert.ok(html.includes("展示顺序不代表价格或质量排名"));
  assert.deepEqual(data, before);
});
