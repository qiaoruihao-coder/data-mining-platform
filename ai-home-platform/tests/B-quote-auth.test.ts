import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";
import { POST } from "../src/app/api/quote/route";
import { handleQuoteSubmission, type QuoteSubmissionAuth } from "../src/lib/quote-engine/submit-request";

const input = { demandId: "saved-demand", estimatedDays: 10, items: [
  { code: "line", name: "测试施工", unit: "job", quantity: 0.145, unitPriceCents: 100, note: "合成测试" },
] };
const request = (value: unknown = input, key: string | null = "test-http-key-0001") => new Request("http://localhost/api/quote", {
  method: "POST", headers: key === null ? {} : { "Idempotency-Key": key }, body: JSON.stringify(value),
});
const providerSession = async () => ({ userId: "test-user", role: "provider", providerId: "test-provider" });
const auth: QuoteSubmissionAuth = { readSession: providerSession, readTransactionSession: providerSession };

async function expectFailure(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.equal("data" in body, false);
  assert.equal("meta" in body, false);
  return body;
}

test("公开 POST 默认 401，客户端身份提示不能产生登录且请求体不被消费", async () => {
  const req = new Request("http://localhost/api/quote?providerId=provider-a", {
    method: "POST", headers: { "x-provider-id": "provider-a", "x-role": "provider", cookie: "role=provider; providerId=provider-a" }, body: "{",
  });
  await expectFailure(await POST(req), 401, "UNAUTHENTICATED");
  assert.equal(req.bodyUsed, false);
  await expectFailure(await POST(request({ ...input, providerId: "provider-a" })), 401, "UNAUTHENTICATED");
});

test("认证失败优先于幂等键、JSON 和数据库，不消费请求体或进入事务", async (t) => {
  const transaction = t.mock.fn(async () => { throw new Error("unexpected database access"); });
  const db = { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">;
  for (const [session, status, code] of [
    [null, 401, "UNAUTHENTICATED"],
    [{ userId: "u", role: "owner", providerId: null }, 403, "FORBIDDEN"],
    [{ userId: "u", role: "admin", providerId: null }, 403, "FORBIDDEN"],
    [{ userId: "u", role: "provider", providerId: null }, 403, "FORBIDDEN"],
  ] as const) {
    const req = request(undefined, null);
    await expectFailure(await handleQuoteSubmission(req, { ...auth, readSession: async () => session }, db), status, code);
    assert.equal(req.bodyUsed, false);
  }
  await expectFailure(await handleQuoteSubmission(request(), { ...auth, readSession: async () => { throw new Error("session secret"); } }, db), 401, "UNAUTHENTICATED");
  assert.equal(transaction.mock.callCount(), 0);
});

test("认证后缺失或非法幂等键在读取 JSON 前拒绝，合法键仍须验证输入和数据库范围", async (t) => {
  const transaction = t.mock.fn(async () => { throw new Error("unexpected database access"); });
  const db = { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">;
  for (const key of [null, "short", "x".repeat(129), "bad-key-with-dot.", "one-key-00000001,other-key-00000002"]) {
    const req = request(input, key);
    await expectFailure(await handleQuoteSubmission(req, auth, db), 400, "VALIDATION_ERROR");
    assert.equal(req.bodyUsed, false);
  }
  for (const value of [
    { ...input, providerId: "forged" }, { ...input, knownTotalCents: 1 }, { ...input, items: [] },
    { ...input, items: [{ ...input.items[0], quantity: 2, unitPriceCents: Number.MAX_SAFE_INTEGER }] },
    { ...input, estimatedDays: 2_147_483_648 },
    { ...input, items: [{ ...input.items[0], quantity: 1, unitPriceCents: 2_147_483_648 }] },
  ]) await expectFailure(await handleQuoteSubmission(request(value), auth, db), 400, "VALIDATION_ERROR");
  assert.equal(transaction.mock.callCount(), 0);
});

test("明确事务冲突重试耗尽返回 503，未知错误返回 500，均不泄露异常或宣称此前未保存", async (t) => {
  for (const code of ["P2034", "P2002", "P1017", "unknown"]) {
    const transaction = t.mock.fn(async () => {
      throw code === "unknown" ? new Error("private database secret")
        : new Prisma.PrismaClientKnownRequestError("private database secret", { code, clientVersion: "test" });
    });
    const db = { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">;
    const conflict = code === "P2034" || code === "P2002";
    const body = await expectFailure(await handleQuoteSubmission(request(), auth, db), conflict ? 503 : 500, conflict ? "DATABASE_UNAVAILABLE" : "INTERNAL_ERROR");
    assert.equal(transaction.mock.callCount(), conflict ? 3 : 1);
    assert.ok(!body.error.message.includes("private"));
    assert.ok(body.error.message.includes("保留原幂等键和原输入"));
    if (!conflict) assert.ok(body.error.message.includes("无法确认"));
  }
});
