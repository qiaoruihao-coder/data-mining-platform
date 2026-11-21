import test from "node:test";
import assert from "node:assert/strict";
import { Payment, PaymentActionInput, envelope } from "../src/contracts";
import { POST, GET } from "../src/app/api/payment/route";
import { confirmDemoPayment } from "../src/lib/payment-state";

const request = (body: unknown) => new Request("http://localhost/api/payment", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("付款动作契约只允许确认演示节点", () => {
  assert.deepEqual(PaymentActionInput.parse({ paymentId: "payment-demo", action: "confirm_demo" }), {
    paymentId: "payment-demo",
    action: "confirm_demo",
  });
  assert.equal(PaymentActionInput.safeParse({ paymentId: "payment-demo", action: "confirm" }).success, false);
  assert.equal(PaymentActionInput.safeParse({ paymentId: "payment-demo", action: "confirm_demo", amountCents: 1 }).success, false);
});

test("演示付款状态只能从 pending 转为 confirmed_demo", () => {
  assert.equal(confirmDemoPayment("pending"), "confirmed_demo");
  assert.throws(() => confirmDemoPayment("confirmed_demo"), /已确认/);
});

test("POST /api/payment 对坏 JSON 和非法动作返回 400", async () => {
  const badJson = await POST(request("{"));
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, "INVALID_JSON");

  const invalid = await POST(request({ paymentId: "payment-demo", action: "confirm" }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
});

test("POST /api/payment 首次确认返回 mock 成功并保留 simulated", async () => {
  const response = await POST(request({ paymentId: "payment-demo", action: "confirm_demo" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  const parsed = envelope(Payment).parse(body);
  assert.equal(parsed.meta.source, "mock");
  assert.equal(parsed.data.status, "confirmed_demo");
  assert.equal(parsed.data.simulated, true);
});

test("同一演示节点再次确认返回 409，未知节点返回 404", async () => {
  const repeated = await POST(request({ paymentId: "payment-demo", action: "confirm_demo" }));
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).error.code, "PAYMENT_ALREADY_CONFIRMED");

  const missing = await POST(request({ paymentId: "missing-payment", action: "confirm_demo" }));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "PAYMENT_NOT_FOUND");
});

test("GET /api/payment 反映演示状态且来源明确", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.meta.source, "mock");
  assert.equal(body.data[0].status, "confirmed_demo");
  assert.equal(body.data[0].simulated, true);
});
