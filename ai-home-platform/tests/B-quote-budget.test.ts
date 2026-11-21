import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, Quote, type QuoteDTO } from "../src/contracts";
import { compareQuoteBudget } from "../src/lib/quote-engine/budget";
import { QuoteBudgetSummary } from "../src/features/b/QuoteBudgetSummary";
import { QuoteComparison } from "../src/features/b/QuoteComparison";
import { QuoteTable } from "../src/components/QuoteTable";
import { loadQuoteData } from "../src/lib/quote-engine/data";

// 合成需求和报价只供测试，不作为生产报价或登录身份。
const demand = Demand.parse({ id: "budget-test", description: "合成需求", city: "测试城市", areaM2: 10,
  budgetMinCents: 10000, budgetMaxCents: 20000, renovationType: "repair", desiredDays: 5, status: "published", source: "mock" });
function quote(amount: number | null): QuoteDTO {
  return Quote.parse({ id: "quote-test", demandId: demand.id, providerId: "provider-test", status: "submitted",
    estimatedDays: 5, knownTotalCents: 999999, pendingItems: [],
    items: [{ code: "item-test", name: "合成明细", unit: "job", quantity: 1, unitPriceCents: amount, amountCents: amount, note: "测试范围" }] });
}
const render = (value: QuoteDTO, selectedDemand = demand) => renderToStaticMarkup(createElement(QuoteBudgetSummary, { demand: selectedDemand, quote: value }));

test("按明细而非缓存小计对照预算，精确处理上下限内外的一分差", () => {
  for (const [amount, position, difference] of [
    [9999, "below", 1], [10000, "within", 10000], [10001, "within", 9999],
    [19999, "within", 1], [20000, "at-limit", 0], [20001, "above", 1],
  ] as const) {
    const value = quote(amount);
    const before = structuredClone(value);
    assert.deepEqual(compareQuoteBudget(demand, value), { position, differenceCents: difference, hasPending: false });
    assert.deepEqual(value, before);
  }
});

test("逐行合计决定是否超预算，不推算历史 null 金额", () => {
  const value = quote(15000);
  value.items.push({ ...value.items[0], code: "second", amountCents: 5001 });
  value.items.push({ ...value.items[0], code: "unknown", amountCents: null, unitPriceCents: 999999 });
  assert.deepEqual(compareQuoteBudget(demand, value), { position: "above", differenceCents: 1, hasPending: true });
  assert.ok(render(value).includes("已知小计已超过预算上限 ¥0.01"));
});

test("全部未知费用和空明细不将零小计解释为低于预算或免费", () => {
  const unknown = quote(null);
  const empty = { ...unknown, items: [] };
  assert.deepEqual(compareQuoteBudget(demand, unknown), { position: "unpriced", differenceCents: null, hasPending: true });
  assert.deepEqual(compareQuoteBudget(demand, empty), { position: "no-details", differenceCents: null, hasPending: false });
  for (const value of [unknown, empty]) {
    const html = render(value);
    assert.ok(html.includes("暂不能与预算比较"));
    assert.ok(!html.includes("低于预算下限"));
    assert.ok(!html.includes("距预算上限"));
    assert.ok(!html.includes("免费"));
  }
});

test("明确列明的零元可以对照预算，零预算及固定预算的边界准确", () => {
  assert.equal(compareQuoteBudget(demand, quote(0))?.position, "below");
  const zeroBudget = { ...demand, budgetMinCents: 0, budgetMaxCents: 0 };
  assert.equal(compareQuoteBudget(zeroBudget, quote(0))?.position, "at-limit");
  assert.equal(compareQuoteBudget(zeroBudget, quote(null))?.position, "unpriced");
  assert.deepEqual(compareQuoteBudget(zeroBudget, quote(1)), { position: "above", differenceCents: 1, hasPending: false });
  const fixedBudget = { ...demand, budgetMinCents: 20000 };
  assert.equal(compareQuoteBudget(fixedBudget, quote(20000))?.position, "at-limit");
  assert.equal(compareQuoteBudget(fixedBudget, quote(19999))?.position, "below");
});

test("已列明金额但单价未知、额外待确认费用均保留最终金额不确定提示", () => {
  const unknownPrice = quote(15000);
  unknownPrice.items[0].unitPriceCents = null;
  const extra = { ...quote(15000), pendingItems: ["现场增项"] };
  for (const value of [unknownPrice, extra]) {
    assert.equal(compareQuoteBudget(demand, value)?.hasPending, true);
    const html = render(value);
    assert.ok(html.includes("已知小计处于预算区间"));
    assert.ok(html.includes("仍有待确认费用，最终金额尚不能确定"));
    assert.ok(html.includes("差额不是可用余额"));
    assert.ok(!html.includes("预算足够"));
  }
});

test("不同需求及倒置预算不生成对照结果，不用另一份需求的预算下结论", () => {
  for (const invalid of [{ ...demand, id: "another-demand" }, { ...demand, budgetMinCents: 20001 }]) {
    assert.equal(compareQuoteBudget(invalid, quote(15000)), null);
    assert.equal(render(quote(15000), invalid), "");
  }
});

test("安全整数边界保留一分钱差额，累计溢出拒绝生成预算结论", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const largeBudget = { ...demand, budgetMinCents: 0, budgetMaxCents: max };
  assert.equal(compareQuoteBudget(largeBudget, quote(max - 1))?.differenceCents, 1);
  assert.ok(render(quote(max - 1), largeBudget).includes("距预算上限 ¥0.01"));
  assert.equal(compareQuoteBudget({ ...largeBudget, budgetMaxCents: max - 1 }, quote(max))?.differenceCents, 1);
  const overflow = quote(max);
  overflow.items.push({ ...overflow.items[0], code: "extra-cent", amountCents: 1 });
  assert.throws(() => compareQuoteBudget(largeBudget, overflow));
});

test("预算下限、区间、上限和超额文案均只针对已知小计，明细全定价也不承诺最终总价", () => {
  for (const [amount, message] of [
    [9999, "已知小计低于预算下限 ¥0.01"], [15000, "已知小计处于预算区间，距预算上限 ¥50.00"],
    [20000, "已知小计已达到预算上限"], [20001, "已知小计已超过预算上限 ¥0.01"],
  ] as const) {
    const html = render(quote(amount));
    assert.ok(html.includes(message), message);
    assert.ok(html.includes("实际范围及增项仍需确认"));
    assert.ok(html.includes("也不代表最终总价更低"));
    assert.ok(!html.includes("仍有待确认费用"));
  }
});

test("报价页把当前需求预算传入每份报价，并保留 mock 来源和未知费用", () => {
  const data = loadQuoteData();
  assert.ok(data);
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data: { ...data, demandSource: "mock", quoteSource: "mock", providerSource: "mock" } }));
  assert.equal((html.match(/aria-label="与需求预算对照"/g) ?? []).length, data.response.data.length);
  assert.ok(html.includes("mock · 模拟报价，不代表真实市场报价"));
  assert.ok(html.includes("仍有待确认费用"));
  assert.ok(html.includes("垃圾清运"));
  assert.ok(html.includes("展示顺序不代表价格或质量排名"));
});

test("无需求上下文的旧调用及空报价列表不会出现猜测预算", () => {
  const noDemand = renderToStaticMarkup(createElement(QuoteTable, { quotes: [quote(15000)] }));
  const noQuotes = renderToStaticMarkup(createElement(QuoteTable, { quotes: [], demand }));
  for (const html of [noDemand, noQuotes]) assert.ok(!html.includes("与需求预算对照"));
});
