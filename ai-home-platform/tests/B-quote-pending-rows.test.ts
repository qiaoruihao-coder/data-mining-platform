import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, QuoteSubmissionInput, type QuoteDTO } from "../src/contracts";
import { QuoteTable } from "../src/components/QuoteTable";
import { getPendingQuoteItems, prepareQuotes, summarizeQuote } from "../src/lib/quote-engine";

// 合成历史报价：输出契约允许重复编号，新提交输入仍禁止重复编号。
const item = (name: string, amountCents: number | null, unitPriceCents: number | null = amountCents): QuoteDTO["items"][number] => ({
  code: "repeated-code", name, unit: "job", quantity: 1, amountCents, unitPriceCents, note: "测试夹具",
});
const historicalQuote = (items: QuoteDTO["items"], pendingItems: string[] = []) => Quote.parse({
  id: "historical-quote", demandId: "test-demand", providerId: "test-provider", status: "submitted",
  estimatedDays: 10, knownTotalCents: 99999, items, pendingItems,
});

test("重复编号的不同费用全部保留，已知行不掩盖未知金额或未知单价", () => {
  const value = historicalQuote([
    item("浴室清运", null, 100),
    item("厨房清运", 200, null),
    item("已定价清运", 300),
    item("免费保护", 0),
  ]);
  const before = structuredClone(value);
  assert.deepEqual(getPendingQuoteItems(value).items.map((row) => row.name), ["浴室清运", "厨房清运"]);
  assert.deepEqual(summarizeQuote(value), { knownTotalCents: 500, pendingItems: ["浴室清运", "厨房清运"] });
  assert.deepEqual(value, before);
});

test("编号与名称都相同的未知行不合并，额外声明仍保留且多次汇总不会增加数量", () => {
  const value = historicalQuote([item("垃圾清运", null), item("垃圾清运", null)], ["垃圾清运", "现场勘查", "现场勘查"]);
  const [first] = prepareQuotes(value.demandId, [value]);
  assert.deepEqual(first.pendingItems, ["现场勘查", "垃圾清运", "垃圾清运"]);
  assert.equal(first.knownTotalCents, 0);
  const parsed = Quote.parse(JSON.parse(JSON.stringify(first)));
  const [second] = prepareQuotes(value.demandId, [parsed]);
  assert.deepEqual(second, first);
  assert.equal(getPendingQuoteItems(second).items.length, 2);
  assert.deepEqual(getPendingQuoteItems(second).extraNames, ["现场勘查"]);
  assert.ok(second.items.every((row) => row.amountCents === null));
});

test("同编号历史行在页面待确认列表逐行显示，保留明细金额与最终总价限制", () => {
  for (const sameName of [true, false]) {
    const value = historicalQuote([item("浴室清运", null), item(sameName ? "浴室清运" : "厨房清运", 200, null)]);
    for (const candidate of [value, prepareQuotes(value.demandId, [value])[0]]) {
      const html = renderToStaticMarkup(createElement(QuoteTable, { quotes: [candidate] }));
      assert.ok(html.includes("待确认项目 · 2 项"));
      const list = /<ul\b[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1];
      assert.ok(list);
      assert.equal((list.match(/<li\b/g) ?? []).length, 2);
      assert.equal(list.split("项目编号：repeated-code").length - 1, 2);
      if (sameName) assert.equal(list.split("浴室清运").length - 1, 2);
      else assert.ok(list.includes("浴室清运") && list.includes("厨房清运"));
      assert.ok(html.includes("¥2.00"));
      assert.ok(!html.includes("¥999.99"));
      assert.ok(html.includes("未知金额未计入小计"));
      assert.ok(html.includes("小计不是最终总价"));
    }
  }
});

test("全已知重复编号不会制造待确认费用，新提交重复编号依旧被公共契约拒绝", () => {
  const value = historicalQuote([item("材料", 0), item("人工", 200)]);
  assert.deepEqual(summarizeQuote(value), { knownTotalCents: 200, pendingItems: [] });
  assert.deepEqual(getPendingQuoteItems(value), { items: [], extraNames: [] });
  const { amountCents: _amount, ...inputItem } = value.items[0];
  assert.equal(QuoteSubmissionInput.safeParse({ demandId: value.demandId, estimatedDays: 10, items: [inputItem, { ...inputItem, name: "另一行" }] }).success, false);
});
