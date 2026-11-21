import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO } from "../src/contracts";
import { demoDemand } from "../src/lib/mock-data";
import { MatchResults } from "../src/features/b/MatchResults";
import { QuoteComparison } from "../src/features/b/QuoteComparison";

// 仅为渲染回归的合成需求，包含公共 Money 允许的边界值，不写入数据库。
function demand(minimum: number, maximum: number): DemandDTO {
  return Demand.parse({ ...demoDemand, budgetMinCents: minimum, budgetMaxCents: maximum, source: "mock" });
}
function matching(value: DemandDTO) {
  return renderToStaticMarkup(createElement(MatchResults, { data: {
    demand: value, demandSource: "mock", providerSource: "mock", performanceSource: "live", readAt: Date.parse("2026-11-14T08:00:00Z"),
    response: { ok: true, data: [], meta: { source: "mock" } },
  } }));
}
function quoting(value: DemandDTO) {
  return renderToStaticMarkup(createElement(QuoteComparison, { data: {
    demand: value, demandSource: "mock", quoteSource: "mock", providerSource: null, providers: [],
    response: { ok: true, data: [], meta: { source: "mock" } },
  } }));
}
function budgetText(html: string) {
  const budget = /<dt[^>]*>预算范围<\/dt><dd[^>]*>(.*?)<\/dd>/.exec(html);
  assert.ok(budget, "页面应显示需求预算范围");
  return budget[1];
}

test("匹配页预算保留零元、一分钱及两位小数，不把需求预算当作未知费用", () => {
  for (const [minimum, maximum, expected] of [
    [0, 1, "¥0.00 – ¥0.01"],
    [110, 199, "¥1.10 – ¥1.99"],
    [10000, 10001, "¥100.00 – ¥100.01"],
    [3000000, 5000000, "¥30,000.00 – ¥50,000.00"],
    [0, 0, "¥0.00 – ¥0.00"],
  ] as const) {
    assert.equal(budgetText(matching(demand(minimum, maximum))), expected);
  }
});

test("匹配页在安全整数上限仍区分一分钱差额，避免浮点除法丢失分位", () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(budgetText(matching(demand(max - 1, max))), "¥90,071,992,547,409.90 – ¥90,071,992,547,409.91");
  assert.equal(budgetText(matching(demand(max - 92, max - 91))), "¥90,071,992,547,408.99 – ¥90,071,992,547,409.00");
});

test("同一需求在匹配和报价页的预算完全一致，显示不会修改原始分值或模拟来源", () => {
  for (const [minimum, maximum] of [[0, 1], [110, 110], [123456, 234567], [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]]) {
    const value = demand(minimum, maximum);
    const before = structuredClone(value);
    const matchHtml = matching(value);
    const quoteHtml = quoting(value);
    assert.equal(budgetText(matchHtml), budgetText(quoteHtml));
    assert.deepEqual(value, before);
    assert.ok(matchHtml.includes("需求来源：模拟数据"));
    assert.ok(quoteHtml.includes("需求来源：模拟数据"));
    assert.ok(matchHtml.includes("当前不作为已满足条件"));
  }
});
