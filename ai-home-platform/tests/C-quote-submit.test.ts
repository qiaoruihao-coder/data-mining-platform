import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IDEMPOTENCY_KEY_HEADER, Quote, QuoteSubmissionInput, type QuoteSubmissionInputDTO, type SourceDTO } from "../src/contracts";
import { emptyQuoteLine, quoteSubmissionInput, validateQuoteForm } from "../src/features/c/quote-form";
import { QuoteSubmissionFeedback } from "../src/features/c/QuoteForm";
import { quoteSubmissionFailure, submitQuote, type QuoteSubmissionState } from "../src/features/c/quote-submit";

// 以下均为测试输入/模拟回执，运行页面不会填充这些记录。
const form = {
  lines: [
    { ...emptyQuoteLine(1), name: "零元检测", quantity: "1", priceYuan: "0" },
    { ...emptyQuoteLine(2), name: "现场施工", quantity: "0.145", priceYuan: "1" },
    { ...emptyQuoteLine(3), name: "待定材料", quantity: "1", priceYuan: "999", pending: true, note: "选型后确认" },
  ],
  estimatedDays: "3",
};
const result = validateQuoteForm(form);
assert.equal(result.kind, "preview");
if (result.kind !== "preview") throw new Error("测试输入应通过预览");
const input = quoteSubmissionInput("C-submit-test", result.preview);
const key = "C-submit-test-key-0001";
const quote = Quote.parse({
  ...result.preview, id: "C-test-quote", demandId: input.demandId, providerId: "C-test-provider", status: "submitted",
});
function envelope(data: unknown = quote, source: SourceDTO = "live") { return { ok: true, data, meta: { source } }; }
function render(state: QuoteSubmissionState, onRetry?: () => void) {
  return renderToStaticMarkup(createElement(QuoteSubmissionFeedback, { state, onRetry }));
}

test("从预览构造公共输入只保留允许字段，分数金额留给服务端计算，0 与 null 分开", () => {
  assert.deepEqual(QuoteSubmissionInput.parse(input), input);
  assert.deepEqual(Object.keys(input).sort(), ["demandId", "estimatedDays", "items"]);
  for (const item of input.items) assert.deepEqual(Object.keys(item).sort(), ["code", "name", "note", "quantity", "unit", "unitPriceCents"]);
  assert.deepEqual(input.items.map((item) => item.unitPriceCents), [0, 100, null]);
  assert.equal(input.items[1].quantity, 0.145);
  assert.equal(result.preview.knownTotalCents, 15);
  assert.throws(() => quoteSubmissionInput(" ", result.preview));
});

test("提交仅 POST 公共报价接口，保持需求 ID、来源及服务端回执，不写浏览器存储", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/quote");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get(IDEMPOTENCY_KEY_HEADER), key);
    assert.equal([...headers].length, 2);
    assert.deepEqual(JSON.parse(String(init.body)), input);
    return Response.json(envelope(), { status: 201 });
  });
  assert.deepEqual(await submitQuote(input, key), { data: quote, source: "live" });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("缺失或非法幂等键在网络前拒绝，不给请求体添加幂等或身份字段", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应发送"); });
  for (const badKey of [undefined, null, "", "a".repeat(15), "a".repeat(129), "C-key-with-space 123", "中文幂等键测试0000000000", "C-key-with-newline\n123"]) {
    await assert.rejects(submitQuote(input, badKey as string), (error: unknown) => {
      const state = quoteSubmissionFailure(error);
      assert.equal(state.status, "rejected");
      assert.match(render(state), /本次未发送请求/);
      return true;
    });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("幂等冲突保留未知状态但不提供重试，不引导换键或丢掉原提交标识", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "内部摘要与数据库内容" },
  }, { status: 409 }));
  await assert.rejects(submitQuote(input, key), (error: unknown) => {
    const state = quoteSubmissionFailure(error);
    assert.equal(state.status, "uncertain");
    const html = render(state, () => {});
    assert.match(html, /已有报价需要核实/);
    assert.match(html, /不会换标识重发/);
    assert.equal(state.retryable, false);
    assert.doesNotMatch(html, /先刷新需求详情|内部摘要|报价已提交|本次未提交成功|使用同一标识重试|复用本次提交标识和内容|重试/);
    return true;
  });
});

test("非法数量、空需求编号或客户端伪造身份/金额在网络前拒绝", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应调用"); });
  for (const bad of [
    { ...input, demandId: " " },
    { ...input, providerId: "forged-provider" },
    { ...input, status: "submitted" },
    { ...input, knownTotalCents: 0 },
    { ...input, items: [{ ...input.items[0], amountCents: 0 }] },
    { ...input, items: [{ ...input.items[0], quantity: 1000000.001 }] },
  ]) {
    await assert.rejects(submitQuote(bad as QuoteSubmissionInputDTO, key), (error: unknown) => quoteSubmissionFailure(error).status === "rejected");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("400/401/403/404/409/501/503 显示拒绝原因，不回显内部异常或清空输入", async (t) => {
  for (const [status, text] of [
    [400, "字段未通过校验"], [401, "身份授权"], [403, "无权提交"], [404, "需求不存在"],
    [409, "需求状态已变化"], [501, "尚未开放"], [503, "暂时不可用"],
  ] as const) {
    const before = structuredClone(input);
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "FAILURE", message: "内部敏感错误" } }, { status }));
    await assert.rejects(submitQuote(input, key), (error: unknown) => {
      const state = quoteSubmissionFailure(error);
      assert.equal(state.status, "rejected");
      const html = render(state);
      for (const expected of [text, 'role="alert"', "填写内容仍保留", "报价未提交成功"]) assert.ok(html.includes(expected), expected);
      assert.doesNotMatch(html, /报价已提交|模拟报价回执|内部敏感/);
      return true;
    });
    assert.deepEqual(input, before);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("HTTP 501 即使携带成功信封或非 JSON，也只能显示尚未开放", async (t) => {
  for (const response of [Response.json(envelope(), { status: 501 }), new Response("not json", { status: 501 })]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(submitQuote(input, key), (error: unknown) => {
      assert.match(render(quoteSubmissionFailure(error)), /HTTP 501/);
      assert.equal(quoteSubmissionFailure(error).status, "rejected");
      return true;
    });
    mock.mock.restore();
  }
});

test("错位需求、非 submitted、缺来源、坏字段和 200 失败均不能确认提交", async (t) => {
  for (const body of [
    envelope({ ...quote, demandId: "other-demand" }),
    ...["draft", "accepted", "rejected"].map((status) => envelope({ ...quote, status })),
    { ok: true, data: quote }, envelope({ ...quote, knownTotalCents: -1 }),
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "内部错误" } },
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(submitQuote(input, key), (error: unknown) => {
      const state = quoteSubmissionFailure(error);
      assert.equal(state.status, "uncertain");
      const html = render(state);
      assert.match(html, /提交结果未知/);
      assert.doesNotMatch(html, /报价已提交|本次未提交成功|模拟报价回执/);
      return true;
    });
    mock.mock.restore();
  }
});

test("网络中断、500 和坏 JSON 保持结果未知，显示同键重试且不自动重发", async (t) => {
  for (const failure of [
    async () => { throw new TypeError("网络中断"); },
    async () => Response.json(envelope(), { status: 500 }),
    async () => new Response("not json"),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", failure);
    await assert.rejects(submitQuote(input, key), (error: unknown) => {
      const html = render(quoteSubmissionFailure(error), () => {});
      for (const text of ["提交结果未知", "先联系平台核实", "使用同一标识重试", "填写内容仍保留"]) assert.ok(html.includes(text));
      assert.doesNotMatch(html, /报价已提交|本次提交失败|本次未提交成功/);
      return true;
    });
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("未知状态没有重试回调时仍显示入口但禁用按钮", () => {
  const html = render({ status: "uncertain", message: "结果未知" });
  assert.match(html, /使用同一标识重试/);
  assert.match(html, /disabled/);
});

test("回执展示服务端金额与来源，说明所属业主可查看但不保证已阅读、接受或接单", async (t) => {
  for (const source of ["mock", "live"] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(envelope({ ...quote, id: "<script>test</script>", knownTotalCents: 250 }, source)));
    const html = render({ status: "received", response: await submitQuote(input, key) });
    for (const text of ["¥2.50", "待确认费用", "完整总价仍未确定", "业主可在报价对比页查看", "是否接单以业主确认为准", "请勿重复提交", "&lt;script&gt;"]) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /<script|本地报价预览|本次未提交成功|页面接线仍待完成|本页不确认业主已可查看/);
    if (source === "mock") {
      assert.match(html, /模拟报价已提交/);
      assert.match(html, /模拟报价已保存。/);
      assert.doesNotMatch(html, />报价已提交<|模拟接口响应|不代表真实保存/);
    } else {
      assert.match(html, /报价已提交/);
      assert.match(html, /等待业主确认/);
    }
    mock.mock.restore();
  }
});

test("初始没有回执，等待响应时仅显示提交中，不提前显示来源或成功", () => {
  assert.equal(render({ status: "idle" }), "");
  const html = render({ status: "submitting" });
  assert.match(html, /正在提交报价/);
  assert.doesNotMatch(html, /mock|live|报价已提交|报价未提交成功/);
});
