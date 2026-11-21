import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, QuoteItem, QuoteSubmissionItemInput } from "../src/contracts";
import { QuoteForm, QuotePreview } from "../src/features/c/QuoteForm";
import {
  emptyQuoteLine, formatQuoteMoney, MAX_QUOTE_LINES, quotePriceToCents, validateQuoteForm,
  type QuoteFormFields, type QuoteLineFields,
} from "../src/features/c/quote-form";

// 仅为测试输入；页面初始表单为空，不预填模拟服务方报价。
function line(patch: Partial<QuoteLineFields> = {}): QuoteLineFields {
  return { ...emptyQuoteLine(1), name: "测试施工", unit: "m2", quantity: "12.5", priceYuan: "80.01", ...patch };
}
function fields(lines = [line()], estimatedDays = "10"): QuoteFormFields { return { lines, estimatedDays }; }
function preview(input: QuoteFormFields) {
  const result = validateQuoteForm(input);
  assert.equal(result.kind, "preview");
  if (result.kind !== "preview") throw new Error(JSON.stringify(result));
  return result.preview;
}
function invalid(input: QuoteFormFields) {
  const result = validateQuoteForm(input);
  assert.equal(result.kind, "invalid");
  if (result.kind !== "invalid") throw new Error("应拒绝无效输入");
  return result.errors;
}

test("单价从十进制字符串精确转分，空白、负数、指数和多余小数不被当作有效金额", () => {
  for (const [input, cents] of [["0", 0], [" 0.01 ", 1], ["1.01", 101], ["12.3", 1230], ["90071992547409.91", Number.MAX_SAFE_INTEGER]] as const) {
    assert.equal(quotePriceToCents(input), cents);
  }
  for (const input of ["", " ", "-1", "1.001", "NaN", "Infinity", "1e3", "0x10", "1,000", "1.2abc", "90071992547409.92"]) {
    assert.equal(quotePriceToCents(input), null, input);
  }
  assert.equal(formatQuoteMoney(Number.MAX_SAFE_INTEGER), "¥90,071,992,547,409.91");
});

test("分数数量的预览按每行四舍五入到分，符合公共 Quote 字段且不产生提交身份", () => {
  const data = preview(fields([line(), line({ code: "line-2", quantity: "0.5", priceYuan: "0.01" })]));
  assert.equal(data.items[0].amountCents, 100013); // 12.5 × 80.01 元 = 1000.125 元
  assert.equal(data.items[1].amountCents, 1);
  assert.equal(data.knownTotalCents, 100014);
  assert.equal(data.estimatedDays, 10);
  assert.deepEqual(Quote.pick({ items: true, estimatedDays: true, knownTotalCents: true, pendingItems: true }).parse(data), data);
  assert.ok(data.items.every((item) => QuoteItem.safeParse(item).success));
  for (const key of ["id", "providerId", "status", "ok", "meta"]) assert.ok(!(key in data), key);
  const perLine = preview(fields([line({ quantity: "0.5", priceYuan: "0.01" }), line({ code: "line-2", quantity: "0.5", priceYuan: "0.01" })]));
  assert.equal(perLine.knownTotalCents, 2);
});

test("公共输入允许的半分边界精确舍入，每行先舍入再合计", () => {
  for (const [quantity, expectedCents] of [
    ["0.144", 14], ["0.145", 15], ["0.146", 15],
    ["1.004", 100], ["1.005", 101], ["1.006", 101],
  ] as const) {
    assert.ok(QuoteSubmissionItemInput.safeParse({
      code: "line-1", name: "测试施工", unit: "m2", quantity: Number(quantity), unitPriceCents: 100, note: "",
    }).success);
    const data = preview(fields([line({ quantity, priceYuan: "1.00" })]));
    assert.equal(data.items[0].amountCents, expectedCents, quantity);
    assert.equal(data.knownTotalCents, expectedCents, quantity);
  }
  const data = preview(fields([
    line({ quantity: "0.145", priceYuan: "1.00" }),
    line({ code: "line-2", quantity: "0.145", priceYuan: "1.00" }),
  ]));
  assert.deepEqual(data.items.map((item) => item.amountCents), [15, 15]);
  assert.equal(data.knownTotalCents, 30);
  const html = renderToStaticMarkup(createElement(QuotePreview, { preview: data }));
  assert.match(html, /¥0.15/);
  assert.match(html, /¥0.30/);
  assert.match(html, /报价预览 · 未提交/);
});

test("待确认与零元分开，同名待确认明细按编号保留两行，既有单价不会误入小计", () => {
  const data = preview(fields([
    line({ priceYuan: "0" }),
    line({ code: "line-2", pending: true, priceYuan: "9999", note: "现场测量" }),
    line({ code: "line-3", pending: true, priceYuan: "", note: "材料选型待定" }),
  ]));
  assert.equal(data.items[0].unitPriceCents, 0);
  assert.equal(data.items[0].amountCents, 0);
  assert.equal(data.knownTotalCents, 0);
  assert.deepEqual(data.pendingItems, ["测试施工", "测试施工"]);
  for (const item of data.items.slice(1)) {
    assert.equal(item.unitPriceCents, null);
    assert.equal(item.amountCents, null);
  }
  const html = renderToStaticMarkup(createElement(QuotePreview, { preview: data }));
  for (const text of ["报价预览 · 未提交", "尚未提交", "业主暂不可见", "另有 2 项费用待确认", "无法确定完整总价", "¥0.00", "现场测量", "材料选型待定"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /最终总价|提交成功|报价成功/);
});

test("空单价不是零元或自动待确认；取消待确认后重新校验单价", () => {
  assert.ok(invalid(fields([line({ priceYuan: "" })]))["line-1-priceYuan"]);
  assert.ok(invalid(fields([line({ pending: true, note: " " })]))["line-1-note"]);
  const pending = line({ priceYuan: "", pending: true, note: "待测量" });
  assert.equal(preview(fields([pending])).items[0].amountCents, null);
  assert.ok(invalid(fields([{ ...pending, pending: false }]))["line-1-priceYuan"]);
});

test("数量与工期须有效，不接受静默截断、非有限数或不安全整数", () => {
  for (const value of ["", "0", "-1", "1.0001", "1000000.001", "1000001", "Infinity", "1e3", "2abc", "9007199254740991", "9007199254740.991"]) {
    assert.ok(invalid(fields([line({ quantity: value })]))["line-1-quantity"], value);
  }
  for (const value of ["", "0", "-1", "1.5", "1e2", "NaN", "9007199254740992"]) {
    assert.ok(invalid(fields([line()], value)).estimatedDays, value);
  }
  assert.equal(preview(fields([line({ quantity: "0.001", priceYuan: "10" })])).items[0].amountCents, 1);
  assert.equal(preview(fields([line({ quantity: "1000000", priceYuan: "0.01" })])).items[0].amountCents, 1000000);
});

test("单行金额溢出与累计溢出均阻止预览，未知费用不参与累计", () => {
  assert.ok(invalid(fields([line({ quantity: "2", priceYuan: "90071992547409.91" })]))["line-1-priceYuan"]);
  const maxLine = line({ quantity: "1", priceYuan: "90071992547409.91" });
  assert.ok(invalid(fields([maxLine, line({ code: "line-2", quantity: "1", priceYuan: "0.01" })])).lines);
  assert.equal(preview(fields([maxLine, line({ code: "line-2", pending: true, note: "待定" })])).knownTotalCents, Number.MAX_SAFE_INTEGER);
});

test("明细不能为空、超量或重复编号；删除后新增项目可用独立编号且不改变其他行", () => {
  assert.ok(invalid(fields([])).lines);
  assert.ok(invalid(fields(Array.from({ length: MAX_QUOTE_LINES + 1 }, (_, i) => line({ code: `line-${i + 1}` })))).lines);
  assert.ok(invalid(fields([line(), line()])).lines);
  assert.ok(invalid(fields([line(), line({ code: " line-1 " })])).lines);
  for (const code of [" ", "x".repeat(101)]) assert.ok(invalid(fields([line({ code })])).lines);
  const remaining = line({ code: "line-2", quantity: "2", priceYuan: "5" });
  const next = line({ ...emptyQuoteLine(3), name: "新增项目", quantity: "1", priceYuan: "3" });
  const data = preview(fields([remaining, next]));
  assert.deepEqual(data.items.map((item) => item.code), ["line-2", "line-3"]);
  assert.equal(data.knownTotalCents, 1300);
  assert.equal(remaining.priceYuan, "5");
});

test("名称与备注长度校验，预览安全转义用户文本，不修改原始输入", () => {
  for (const name of [" ", "字".repeat(101)]) assert.ok(invalid(fields([line({ name })]))["line-1-name"]);
  assert.ok(invalid(fields([line({ note: "字".repeat(1001) })]))["line-1-note"]);
  const input = fields([line({ name: " <script>alert(1)</script> ", note: "  <b>测试</b>  " })]);
  const before = structuredClone(input);
  const data = preview(input);
  assert.deepEqual(input, before);
  const html = renderToStaticMarkup(createElement(QuotePreview, { preview: data }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<script|<b>/);
});

test("表单初始为空并绑定需求，预览前禁用提交；校验与预览不调用网络接口", (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("本地预览不应发请求"); });
  const html = renderToStaticMarkup(createElement(QuoteForm, { demandId: "C-test-demand" }));
  for (const text of ["C-test-demand", "先预览", "刷新或离开页面会丢失", "账号登录不等于资质认证", "先预览，确认后再提交", "检查并预览报价", "上限 1,000,000"]) assert.ok(html.includes(text), text);
  assert.match(html, /<button[^>]*disabled=""[^>]*>尝试提交报价/);
  assert.doesNotMatch(html, /name="providerId"|name="status"|报价已提交|报价预览 · 未提交/);
  invalid({ lines: [emptyQuoteLine(1)], estimatedDays: "" });
  preview(fields());
  assert.equal(fetchMock.mock.callCount(), 0);
});
