import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IDEMPOTENCY_KEY_HEADER, Quote, QuoteSubmissionInput } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { QuoteSubmissionFeedback } from "../src/features/c/QuoteForm";
import { createQuoteSubmissionSession } from "../src/features/c/quote-idempotency";
import { quoteSubmissionFailure, quoteUncertainRetryFailure, submitQuote, type QuoteSubmissionState } from "../src/features/c/quote-submit";

// 合成输入和回执仅用于测试，不代表生产身份或真实报价保存。
const input = QuoteSubmissionInput.parse({
  demandId: "C-uncertain-retry-demand",
  items: [{ code: "repair", name: "测试维修", unit: "job", quantity: 1, unitPriceCents: 100, note: "合成夹具" }],
  estimatedDays: 2,
});
const quote = Quote.parse({
  ...input, id: "C-original-quote", providerId: "C-test-provider", status: "submitted", source: "mock",
  items: input.items.map((item) => ({ ...item, amountCents: 100 })), knownTotalCents: 100, pendingItems: [],
});

function render(state: QuoteSubmissionState) {
  return renderToStaticMarkup(createElement(QuoteSubmissionFeedback, { state, onRetry() {} }));
}

test("首次请求拒绝与未知后的重试拒绝分开，后者始终保留未知和原输入锁定提示", () => {
  for (const [status, reason, retryable] of [
    [400, "未通过校验", false], [401, "未通过服务方身份验证", true], [403, "无权重试", false],
    [404, "需求不存在", false], [409, "未取得历史回执", false], [501, "HTTP 501", false], [503, "HTTP 503", true],
  ] as const) {
    const error = new ApiClientError("内部敏感信息", "TEST_REJECTION", status);
    assert.equal(quoteSubmissionFailure(error).status, "rejected");
    const state = quoteUncertainRetryFailure(error);
    assert.equal(state.status, "uncertain");
    assert.equal(state.retryable, retryable);
    const html = render(state);
    for (const text of [reason, "之前的报价仍可能已保存", "原填写内容继续锁定", "不会换标识重发", "填写内容仍保留"]) {
      assert.ok(html.includes(text), text);
    }
    assert.equal(html.includes("使用同一标识重试"), retryable);
    assert.doesNotMatch(html, /报价未提交成功|本次提交失败|本次未提交成功|先刷新需求详情|内部敏感信息/);
  }
});

test("未知后连续遇到 401 和 503，手动重试始终同键同体且可接受原报价回执", async (t) => {
  const random = t.mock.method(globalThis.crypto, "randomUUID");
  const session = createQuoteSubmissionSession();
  const original = session.prepare(input);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_path: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER), original.idempotencyKey);
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    requests += 1;
    if (requests === 1) throw new TypeError("首次回执丢失");
    if (requests <= 3) return Response.json({ ok: false, error: { code: "RETRY_DENIED", message: "内部原因" } }, { status: requests === 2 ? 401 : 503 });
    return Response.json({ ok: true, data: quote, meta: { source: "mock" } }, { status: 200 });
  });

  for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
    assert.equal(requests, attemptNumber - 1, "不得自动重发");
    const attempt = session.prepare(input);
    assert.equal(attempt, original);
    await assert.rejects(submitQuote(attempt.input, attempt.idempotencyKey), (error: unknown) => {
      const state = attemptNumber === 1 ? quoteSubmissionFailure(error) : quoteUncertainRetryFailure(error);
      assert.equal(state.status, "uncertain");
      assert.equal(state.retryable, true);
      assert.match(render(state), /使用同一标识重试/);
      return true;
    });
    assert.equal(requests, attemptNumber);
  }
  const response = await submitQuote(original.input, original.idempotencyKey);
  assert.equal(response.data.id, quote.id);
  assert.equal(response.source, "mock");
  assert.match(render({ status: "received", response }), /模拟报价已保存/);
  assert.equal(requests, 4);
  assert.equal(random.mock.callCount(), 1);
});

test("未知后 409 INVALID_STATE 不能否定上次保存，也不提示刷新换键重报", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ok: false, error: { code: "INVALID_STATE", message: "内部需求状态" },
  }, { status: 409 }));
  const attempt = createQuoteSubmissionSession().prepare(input);
  await assert.rejects(submitQuote(attempt.input, attempt.idempotencyKey), (error: unknown) => {
    const state = quoteUncertainRetryFailure(error);
    assert.equal(state.status, "uncertain");
    assert.equal(state.retryable, false);
    const html = render(state);
    assert.match(html, /联系平台核实/);
    assert.doesNotMatch(html, /<button|报价未提交成功|先刷新需求详情|内部需求状态/);
    return true;
  });
});

test("重试继续异常或坏回执时仍可同键重试，幂等冲突或本地键错误则保持锁定待核实", () => {
  for (const error of [new TypeError("断网"), new ApiClientError("坏回执", "INVALID_RESPONSE", 200), new ApiClientError("服务异常", "HTTP_500", 500)]) {
    const state = quoteUncertainRetryFailure(error);
    assert.equal(state.status, "uncertain");
    assert.equal(state.retryable, true);
    assert.match(render(state), /提交结果未知/);
  }
  for (const error of [new ApiClientError("键冲突", "IDEMPOTENCY_CONFLICT", 409), new ApiClientError("键错误", "LOCAL_INVALID_IDEMPOTENCY_KEY", 400)]) {
    const state = quoteUncertainRetryFailure(error);
    assert.equal(state.status, "uncertain");
    assert.equal(state.retryable, false);
    assert.doesNotMatch(render(state), /<button|报价未提交成功|本次未发送请求/);
  }
});
