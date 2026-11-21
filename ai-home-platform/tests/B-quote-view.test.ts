import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuoteTable } from "../src/components/QuoteTable";
import { QuoteComparison } from "../src/features/b/QuoteComparison";
import { formatQuoteMoney } from "../src/features/b/format-quote";
import { loadQuoteData } from "../src/lib/quote-engine/data";
import { prepareQuotes } from "../src/lib/quote-engine";
import { providers, quotes } from "../src/lib/mock-data";
import { demoDemand } from "../src/lib/mock-data";
import { loadQuoteComparison } from "../src/features/b/load-quotes";

test("混合列表按每份报价标明 mock/live/未知，不从整批或服务方来源推断", async t => {
  const rows = [
    { ...quotes[0], id: "synthetic-mock", source: "mock" },
    { ...quotes[0], id: "synthetic-live", source: "live" },
    { ...quotes[0], id: "synthetic-legacy", source: undefined },
  ];
  // 全部为合成数据，live 仅测试标识，不代表真实报价。
  for (const source of ["mock", "live"] as const) {
    t.mock.method(globalThis, "fetch", async (url: string) => Response.json({
      ok: true, data: url.startsWith("/api/quote?") ? rows : url === "/api/provider" ? providers : { ...demoDemand, source: "live" },
      meta: { source },
    }));
    const data = await loadQuoteComparison(demoDemand.id);
    assert.equal(data.response.meta.source, "mock");
    const html = renderToStaticMarkup(createElement(QuoteComparison, { data }));
    const articles = html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
    assert.equal(articles.length, 3);
    for (const [index, label] of ["mock · 模拟报价", "live · 非模拟报价数据", "来源未知，请核实"].entries()) {
      assert.ok(articles[index].includes(rows[index].id));
      assert.ok(articles[index].includes(`本份报价来源：${label}`));
    }
    assert.ok(!html.includes("展示 3 份模拟报价"));
    t.mock.restoreAll();
  }
});

test("报价金额展示区分未知与零，并保留安全整数范围内的分位", () => {
  assert.equal(formatQuoteMoney(null), "待确认");
  assert.equal(formatQuoteMoney(0), "¥0.00");
  assert.equal(formatQuoteMoney(101), "¥1.01");
  assert.equal(formatQuoteMoney(Number.MAX_SAFE_INTEGER), "¥90,071,992,547,409.91");
});

test("报价页展示来源、供应方、列明费用及服务范围限制", () => {
  const data = loadQuoteData();
  assert.ok(data);
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data: { ...data, demandSource: "mock", quoteSource: "mock", providerSource: "mock" } }));
  for (const text of ["mock · 模拟报价，不代表真实市场报价", providers[0].name, "¥12,000.00", "¥13,000.00", "垃圾清运", "待确认", "不代表最终总价更低", "实际范围需现场确认"]) {
    assert.ok(html.includes(text), text);
  }
  assert.equal((html.match(/<table /g) ?? []).length, 2);
  assert.ok(html.includes('href="/owner/matches/demo-demand"'));
  assert.ok(html.includes('href="/owner/demand/demo-demand"'));
});

test("报价组件重算缓存合计并保留未知项目，不显示虚构总额", () => {
  const html = renderToStaticMarkup(createElement(QuoteTable, { quotes: [{ ...quotes[0], knownTotalCents: 99999900, pendingItems: [] }] }));
  assert.ok(html.includes("¥12,000.00"));
  assert.ok(!html.includes("¥999,999.00"));
  assert.ok(html.includes("待确认项目"));
  assert.ok(html.includes("名称待确认"));
});

test("同名待确认项目分别显示编号和正确数量，能对应到各自明细", () => {
  const prepared = prepareQuotes(quotes[0].demandId, [{ ...quotes[0], pendingItems: ["垃圾清运"], items: [
    { ...quotes[0].items[1], code: "haul-bathroom" },
    { ...quotes[0].items[1], code: "haul-kitchen" },
  ] }]);
  const html = renderToStaticMarkup(createElement(QuoteTable, { quotes: prepared }));
  assert.ok(html.includes("待确认项目 · 2 项"));
  const pendingList = /<ul\b[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1];
  assert.ok(pendingList);
  assert.equal((pendingList.match(/<li\b/g) ?? []).length, 2);
  for (const code of ["haul-bathroom", "haul-kitchen"]) {
    assert.ok(pendingList.includes(`项目编号：${code}`));
    assert.equal(html.split(`项目编号：${code}`).length - 1, 2);
  }
  assert.ok(html.includes("小计不是最终总价"));
});

test("暂无报价与缺少明细给出各自提示，不把空报价描述为完整定价", () => {
  const empty = renderToStaticMarkup(createElement(QuoteTable, { quotes: [] }));
  assert.ok(empty.includes("暂无可对比的报价"));
  assert.ok(!empty.includes("¥0.00"));
  const noItems = renderToStaticMarkup(createElement(QuoteTable, { quotes: [{ ...quotes[0], items: [], pendingItems: [] }] }));
  assert.ok(noItems.includes("暂无报价明细"));
  assert.ok(noItems.includes("总价待确认"));
  assert.ok(!noItems.includes("当前明细金额均已列明"));
});
