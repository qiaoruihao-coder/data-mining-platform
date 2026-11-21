import test from "node:test";
import assert from "node:assert/strict";
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey, QuoteSubmissionInput } from "../src/contracts";
import { createQuoteSubmissionSession } from "../src/features/c/quote-idempotency";
import { quoteSubmissionFailure, submitQuote } from "../src/features/c/quote-submit";

// 仅用于测试的手动输入与响应，不是运行时演示报价。
const input = QuoteSubmissionInput.parse({
  demandId: "C-idempotency-demand",
  items: [
    { code: "line-1", name: "检测", unit: "job", quantity: 1, unitPriceCents: 0, note: "" },
    { code: "line-2", name: "维修", unit: "m2", quantity: 0.145, unitPriceCents: null, note: "现场确认" },
  ],
  estimatedDays: 3,
});

test("表单初始化和编辑不生成键；同内容再次准备复用同一安全随机键", (t) => {
  const random = t.mock.method(globalThis.crypto, "randomUUID");
  const session = createQuoteSubmissionSession();
  session.invalidate();
  assert.equal(random.mock.callCount(), 0);
  const first = session.prepare(input);
  assert.ok(IdempotencyKey.safeParse(first.idempotencyKey).success);
  assert.equal(session.prepare(structuredClone(input)), first);
  assert.equal(random.mock.callCount(), 1);
});

test("编辑后即使改回原值也换键，其他表单和需求不能共用提交会话", () => {
  const session = createQuoteSubmissionSession();
  const first = session.prepare(input);
  session.invalidate();
  const second = session.prepare(input);
  assert.notEqual(second.idempotencyKey, first.idempotencyKey);
  assert.notEqual(createQuoteSubmissionSession().prepare(input).idempotencyKey, first.idempotencyKey);
  const otherDemand = session.prepare({ ...input, demandId: "C-another-demand" });
  assert.notEqual(otherDemand.idempotencyKey, second.idempotencyKey);
});

test("提交快照与原输入隔离，任意业务字段或行顺序变化不能沿用旧键", () => {
  const changes = [
    { ...input, estimatedDays: 4 },
    { ...input, items: [...input.items].reverse() },
    ...[
      { code: "line-new" }, { name: "新项目名" }, { unit: "piece" as const },
      { quantity: 1.5 }, { unitPriceCents: null }, { note: "新增说明" },
    ].map((patch) => ({ ...input, items: [{ ...input.items[0], ...patch }, input.items[1]] })),
  ];
  for (const changed of changes) {
    const session = createQuoteSubmissionSession();
    const first = session.prepare(input);
    assert.notEqual(session.prepare(changed).idempotencyKey, first.idempotencyKey);
    assert.deepEqual(first.input, input);
  }
  const original = structuredClone(input);
  const prepared = createQuoteSubmissionSession().prepare(original);
  original.items[0].name = "之后编辑";
  assert.equal(prepared.input.items[0].name, "检测");
});

test("输入校验失败不生成键；安全随机数不可用时不发送请求或用弱随机数替代", async (t) => {
  const random = t.mock.method(globalThis.crypto, "randomUUID", () => { throw new Error("不可用"); });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应发送"); });
  const session = createQuoteSubmissionSession();
  assert.throws(() => session.prepare({ ...input, estimatedDays: 0 }));
  assert.equal(random.mock.callCount(), 0);
  await assert.rejects(async () => {
    const attempt = session.prepare(input);
    await submitQuote(attempt.input, attempt.idempotencyKey);
  }, (error: unknown) => {
    const state = quoteSubmissionFailure(error);
    assert.equal(state.status, "rejected");
    assert.match(state.message, /本次未发送请求/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("401、501、503、网络和 500 后保留原键与内容，不自动重发", async (t) => {
  for (const failure of [
    async () => Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "未登录" } }, { status: 401 }),
    async () => Response.json({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "未开放" } }, { status: 501 }),
    async () => Response.json({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "已回滚" } }, { status: 503 }),
    async () => { throw new TypeError("连接断开"); },
    async () => new Response("unknown", { status: 500 }),
  ]) {
    const fetchMock = t.mock.method(globalThis, "fetch", failure);
    const session = createQuoteSubmissionSession();
    const attempt = session.prepare(input);
    await assert.rejects(submitQuote(attempt.input, attempt.idempotencyKey));
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(session.prepare(input), attempt);
    assert.deepEqual(attempt.input, input);
    fetchMock.mock.restore();
  }
});

test("同一会话发送同键同体，201 首次回执和 200 重放回执均按公共契约读取", async (t) => {
  const session = createQuoteSubmissionSession();
  const first = session.prepare(input);
  const quote = {
    id: "C-receipt-test", demandId: input.demandId, providerId: "C-provider-test",
    items: input.items.map((item) => ({ ...item, amountCents: item.unitPriceCents })),
    knownTotalCents: 0, pendingItems: ["line-2"], estimatedDays: input.estimatedDays, status: "submitted",
  };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_path: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER), first.idempotencyKey);
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json({ ok: true, data: quote, meta: { source: "live" } }, { status: ++requests === 1 ? 201 : 200 });
  });
  const receipt = await submitQuote(first.input, first.idempotencyKey);
  const repeat = session.prepare(input);
  assert.deepEqual(await submitQuote(repeat.input, repeat.idempotencyKey), receipt);
  assert.equal(requests, 2);
});

test("未知结果后的显式重试复用原键和原请求体", async (t) => {
  const session = createQuoteSubmissionSession();
  const first = session.prepare(input);
  const quote = {
    id: "C-unknown-retry-receipt", demandId: input.demandId, providerId: "C-provider-test",
    items: input.items.map((item) => ({ ...item, amountCents: item.unitPriceCents })),
    knownTotalCents: 0, pendingItems: ["line-2"], estimatedDays: input.estimatedDays, status: "submitted",
  };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_path: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER), first.idempotencyKey);
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    requests += 1;
    if (requests === 1) return new Response("gateway timeout", { status: 500 });
    return Response.json({ ok: true, data: quote, meta: { source: "live" } }, { status: 200 });
  });

  await assert.rejects(submitQuote(first.input, first.idempotencyKey));
  const retry = session.prepare(input);
  assert.deepEqual(retry, first);
  const receipt = await submitQuote(retry.input, retry.idempotencyKey);
  assert.equal(receipt.data.id, quote.id);
  assert.equal(requests, 2);
});
