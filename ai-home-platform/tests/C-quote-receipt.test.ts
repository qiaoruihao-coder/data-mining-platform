import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, QuoteSubmissionInput, type QuoteDTO, type SourceDTO } from "../src/contracts";
import { QuoteSubmissionFeedback } from "../src/features/c/QuoteForm";
import { QuoteReceipt } from "../src/features/c/QuoteReceipt";
import { submitQuote } from "../src/features/c/quote-submit";

// 仅供测试的合成回执；不在运行页面预填或伪造保存结果。
const quote = Quote.parse({
  id: "C-receipt-quote", demandId: "C-receipt-demand", providerId: "C-receipt-provider", source: "mock", status: "submitted",
  items: [
    { code: "free-check", name: "现场作业", unit: "job", quantity: 1, unitPriceCents: 0, amountCents: 0, note: "免费检查" },
    { code: "measured-work", name: "现场作业", unit: "m2", quantity: 0.145, unitPriceCents: 100, amountCents: 15, note: "半分按行舍入" },
    { code: "pending-material", name: "材料", unit: "piece", quantity: 2, unitPriceCents: null, amountCents: null, note: "选型后确认\n含运送费用" },
  ],
  knownTotalCents: 15, pendingItems: ["材料"], estimatedDays: 3,
});
function render(data: QuoteDTO = quote, source: SourceDTO = "mock") {
  return renderToStaticMarkup(createElement(QuoteReceipt, { quote: data, source }));
}
function rows(html: string) {
  const list = html.match(/<ol aria-label="已提交报价明细"[^>]*>(.*?)<\/ol>/s);
  assert.ok(list);
  return [...list[1].matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((match) => match[1]);
}

test("成功提交反馈展示服务端回执各行，同名项目用编号区分，金额不使用本地预览替代", async (t) => {
  const input = QuoteSubmissionInput.parse({
    demandId: quote.demandId, estimatedDays: quote.estimatedDays,
    items: quote.items.map(({ code, name, unit, quantity, unitPriceCents, note }) => ({ code, name, unit, quantity, unitPriceCents, note })),
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: quote, meta: { source: "mock" } }, { status: 201 }));
  const response = await submitQuote(input, "C-receipt-test-key-0001");
  const html = renderToStaticMarkup(createElement(QuoteSubmissionFeedback, { state: { status: "received", response } }));
  const items = rows(html);
  assert.equal(items.length, 3);
  assert.match(items[0], /现场作业.*项目编号：free-check.*单价：¥0\.00\/项.*项目金额：¥0\.00.*免费检查/s);
  assert.match(items[1], /现场作业.*项目编号：measured-work.*数量：0\.145 平方米.*单价：¥1\.00\/平方米.*项目金额：¥0\.15/s);
  assert.match(items[2], /项目编号：pending-material.*数量：2 件；单价：待确认.*项目金额：待确认，未计入小计.*选型后确认\n含运送费用/s);
  for (const text of [quote.id, quote.demandId, quote.providerId, "预计工期：3 天", "已知费用小计：¥0.15", "接口列出的待确认事项", "请勿重复提交", "业主可在报价对比页查看", "是否接单以业主确认为准"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /本地报价预览|尚未保存|最终总价|业主已接受|页面接线仍待完成|本页不确认业主已可查看/);
});

test("只要明细金额或单价未知就保留待确认提示，不依赖 pendingItems 完整性或把未知算零", () => {
  for (const item of [quote.items[2], { ...quote.items[2], unitPriceCents: 100 }, { ...quote.items[2], amountCents: 0 }]) {
    const html = render({ ...quote, items: [item], pendingItems: [], knownTotalCents: 0 });
    assert.match(html, /不按零元计算；完整总价仍未确定/);
    if (item.amountCents === null) assert.doesNotMatch(rows(html)[0], /项目金额：¥0\.00/);
    if (item.unitPriceCents === null) assert.match(rows(html)[0], /单价：待确认/);
  }
  const zeroOnly = render({ ...quote, items: [quote.items[0]], pendingItems: [], knownTotalCents: 0 });
  assert.match(rows(zeroOnly)[0], /项目金额：¥0\.00/);
  assert.doesNotMatch(zeroOnly, /完整总价仍未确定|项目金额：待确认/);
});

test("回执单独显示报价逐条来源，缺省不由接口的 live 或 mock 标识推断", () => {
  for (const source of ["live", "mock"] as const) {
    for (const itemSource of ["live", "mock", undefined] as const) {
      const html = render({ ...quote, source: itemSource }, source);
      assert.match(html, source === "mock" ? /模拟报价已提交/ : /报价已提交/);
      assert.ok(html.includes(itemSource === undefined ? "报价来源待确认" : itemSource === "mock" ? "模拟报价" : "已保存报价"));
    }
  }
  assert.match(render(), /模拟报价已保存。/);
});

test("空明细不编造项目；独立待确认事项保留重复名称和服务端原文", () => {
  const html = render({ ...quote, items: [], pendingItems: ["同名事项", "同名事项"] });
  assert.match(html, /接口未返回报价明细，无法逐项核对/);
  assert.doesNotMatch(html, /<ol|现场作业/);
  assert.equal(html.split("同名事项").length - 1, 2);
  assert.match(html, /完整总价仍未确定/);
});

test("回执保留服务端金额的末位分，所有编号、名称、备注和待确认文本均转义", () => {
  const text = "<script>synthetic()</script>";
  const data = Quote.parse({
    ...quote, id: text, demandId: text, providerId: text,
    items: [{ ...quote.items[0], code: text, name: text, note: text, unitPriceCents: Number.MAX_SAFE_INTEGER, amountCents: Number.MAX_SAFE_INTEGER }],
    knownTotalCents: Number.MAX_SAFE_INTEGER, pendingItems: [text],
  });
  const before = structuredClone(data);
  const html = render(data);
  assert.match(html, /¥90,071,992,547,409\.91/);
  assert.equal(html.split("&lt;script&gt;synthetic()&lt;/script&gt;").length - 1, 7);
  assert.doesNotMatch(html, /<script>/);
  assert.deepEqual(data, before);
});
