import test from "node:test";
import assert from "node:assert/strict";
import { QuoteSubmissionInput } from "../src/contracts";

const validInput = {
  demandId: "demand-1",
  estimatedDays: 10,
  items: [
    {
      code: "bathroom",
      name: "浴室防滑施工",
      unit: "m2" as const,
      quantity: 12.5,
      unitPriceCents: 8000,
      note: "含人工，现场范围待确认",
    },
  ],
};

test("报价提交契约接受合法输入并保留 0 与 null 的区别", () => {
  const parsed = QuoteSubmissionInput.parse({
    ...validInput,
    items: [
      { ...validInput.items[0], unitPriceCents: 0 },
      { ...validInput.items[0], code: "unknown", unitPriceCents: null },
    ],
  });

  assert.equal(parsed.items[0].unitPriceCents, 0);
  assert.equal(parsed.items[1].unitPriceCents, null);
});

test("报价提交契约拒绝重复 code，并按 trim 后的 code 判断重复", () => {
  const result = QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [
      validInput.items[0],
      { ...validInput.items[0], code: " bathroom " },
    ],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some(issue => issue.path.join(".") === "items.1.code"));
  }
});

test("报价提交契约限制明细数量、数量精度和工期", () => {
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], quantity: 1.2345 }],
  }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], quantity: 1_000_000.001 }],
  }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], quantity: 1e-4 }],
  }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    estimatedDays: Number.MAX_SAFE_INTEGER + 1,
  }).success, false);
});

test("报价提交契约拒绝空明细、空名称和超长文本", () => {
  assert.equal(QuoteSubmissionInput.safeParse({ ...validInput, items: [] }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], name: "   " }],
  }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], note: "n".repeat(1001) }],
  }).success, false);
});

test("报价提交契约拒绝客户端伪造服务端字段和未知字段", () => {
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    providerId: "provider-a",
  }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    knownTotalCents: 1,
    pendingItems: [],
    status: "submitted",
  }).success, false);
  assert.equal(QuoteSubmissionInput.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], amountCents: 1 }],
  }).success, false);
});
