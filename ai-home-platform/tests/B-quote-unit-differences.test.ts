import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, type QuoteDTO } from "../src/contracts";
import { findQuoteUnitDifferences } from "../src/lib/quote-engine/unit-differences";
import { QuoteUnitWarnings } from "../src/features/b/QuoteUnitWarnings";
import { QuoteComparison } from "../src/features/b/QuoteComparison";
import { loadQuoteComparison } from "../src/features/b/load-quotes";
import { demoDemand } from "../src/lib/mock-data";

// 合成数据仅用于验证跨报价提示，全部明确标记 mock。
const item = (name: string, unit: QuoteDTO["items"][number]["unit"], code = "line-1"): QuoteDTO["items"][number] => ({
  code, name, unit, quantity: 1, unitPriceCents: 100, amountCents: 100, note: "合成测试明细",
});
const quote = (id: string, items: QuoteDTO["items"], overrides: Partial<QuoteDTO> = {}): QuoteDTO => Quote.parse({
  id, demandId: demoDemand.id, providerId: `provider-${id}`, source: "mock", status: "submitted",
  items, knownTotalCents: 100, pendingItems: [], estimatedDays: 10, ...overrides,
});

test("同名不同编号的平方米/项报价给出对应报价和原始行位置", () => {
  const values = [quote("a", [item("防滑施工", "m2", "floor")]), quote("b", [item("勘测", "job"), item(" 防滑施工 ", "job", "package")])];
  const differences = findQuoteUnitDifferences(demoDemand.id, values);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].name, "防滑施工");
  assert.deepEqual(differences[0].rows.map(row => [row.quoteId, row.itemIndex, row.item.unit]), [["a", 0, "m2"], ["b", 1, "job"]]);
});

test("不把位置编号当作跨报价项目身份，不猜测别名或合并内部空白", () => {
  const values = [quote("a", [item("防滑施工", "m2")]), quote("b", [item("垃圾清运", "job"), item("防滑 施工", "piece"), item("地面防滑", "job")])];
  assert.deepEqual(findQuoteUnitDifferences(demoDemand.id, values), []);
});

test("空列表、单份报价、相同单位和空白名称均不制造跨报价提醒", () => {
  for (const values of [[], [quote("a", [item("施工", "m2"), item("施工", "job")])],
    [quote("a", [item("施工", "job")]), quote("b", [item("施工", "job")])],
    [quote("a", [item(" ", "m2")]), quote("b", [item("", "job")])]]) {
    assert.deepEqual(findQuoteUnitDifferences(demoDemand.id, values), []);
    assert.equal(renderToStaticMarkup(createElement(QuoteUnitWarnings, { demandId: demoDemand.id, quotes: values })), "");
  }
});

test("仅比较同一需求已提交/已接受报价，异需求和草稿拒绝项不影响提醒", () => {
  const first = quote("a", [item("施工", "m2")]);
  const second = quote("b", [item("施工", "job")]);
  assert.deepEqual(findQuoteUnitDifferences(demoDemand.id, [first, { ...second, demandId: "other" },
    { ...second, status: "draft" }, { ...second, status: "rejected" }]), []);
  assert.equal(findQuoteUnitDifferences(demoDemand.id, [first, { ...second, status: "accepted" }]).length, 1);
});

test("重复编号和同名多行不覆盖，多个项目和三种单位分别保留", () => {
  const values = [quote("a", [item("施工", "m2"), item("施工", "piece"), item("清运", "job")]),
    quote("b", [item("施工", "job"), item("清运", "piece")])];
  const result = findQuoteUnitDifferences(demoDemand.id, values);
  assert.deepEqual(result.map(group => [group.name, group.rows.length]), [["施工", 3], ["清运", 2]]);
  assert.deepEqual(result[0].rows.map(row => row.itemIndex), [0, 1, 0]);
});

test("未知费用和零元都参与单位核对，输入金额、来源、顺序均不修改", () => {
  const values = [quote("a", [{ ...item("施工", "m2"), amountCents: null, unitPriceCents: null }]),
    quote("b", [{ ...item("施工", "piece"), amountCents: 0, unitPriceCents: 0 }])];
  const before = structuredClone(values);
  const result = findQuoteUnitDifferences(demoDemand.id, values);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].rows.map(row => row.item.amountCents), [null, 0]);
  assert.deepEqual(values, before);
});

test("页面提醒显示报价编号、行号和单位，并保留同名不等于同范围的说明", () => {
  const html = renderToStaticMarkup(createElement(QuoteUnitWarnings, { demandId: demoDemand.id, quotes: [
    quote("quote-a", [item("施工", "m2")]), quote("quote-b", [item("其他", "job"), item("施工", "piece")]),
  ] }));
  for (const text of ["同名项目计价单位不一致", "quote-a", "quote-b", "第 1 行", "第 2 行", "平方米（㎡）", "件",
    "不能直接比较单价", "不代表施工范围相同", "未出现提醒也不代表报价可直接比较", "不调整金额", "数据来源见下方逐份报价标识"]) {
    assert.ok(html.includes(text), text);
  }
});

test("报价读取到页面接线保留来源、未知与零元，提示在明细表前且不改变金额", async t => {
  const values = [quote("a", [{ ...item("施工", "m2"), unitPriceCents: null, amountCents: null }]),
    quote("b", [{ ...item("施工", "job"), unitPriceCents: 0, amountCents: 0 }])];
  t.mock.method(globalThis, "fetch", async (url: string) => Response.json({
    ok: true, data: url.startsWith("/api/quote?") ? values : url === "/api/provider" ? [] : demoDemand, meta: { source: "mock" },
  }));
  const data = await loadQuoteComparison(demoDemand.id);
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data }));
  assert.ok(html.indexOf("同名项目计价单位不一致") < html.indexOf("<table"));
  assert.ok(html.includes("mock · 模拟报价，不代表真实市场报价"));
  assert.ok(html.includes("待确认"));
  assert.ok(html.includes("¥0.00"));
  assert.ok(!html.includes("¥1.00"));
  assert.deepEqual(data.response.data.map(value => value.items[0].amountCents), [null, 0]);
});
