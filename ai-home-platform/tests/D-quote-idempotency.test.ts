import test from "node:test";
import assert from "node:assert/strict";
import { IdempotencyKey, DatabaseInt, DatabaseMoney, ProviderIdentity, type DemandDTO, type VerifiedSessionDTO } from "../src/contracts";
import { apiPost } from "../src/lib/api-client";
import { authorizeProviderAccount, authorizeProviderQuote } from "../src/lib/quote-policy";
import { canonicalizeQuoteSubmission, hashQuoteSubmission, readIdempotencyKey } from "../src/lib/idempotency";
import { z } from "zod";

const input = {
  demandId: "demand-1",
  estimatedDays: 10,
  items: [{ code: "line", name: "施工", unit: "job", quantity: 1, unitPriceCents: 100, note: "" }],
};
const session: VerifiedSessionDTO = { userId: "user-1", role: "provider", providerId: "provider-1" };
const identity = ProviderIdentity.parse(session);
const demand: DemandDTO = {
  id: "demand-1", description: "需求", city: "深圳", areaM2: 50,
  budgetMinCents: 100, budgetMaxCents: 1000, renovationType: "repair", desiredDays: 10,
  status: "published", source: "live",
};

test("幂等键只接受 16–128 位 ASCII 安全字符", () => {
  assert.equal(IdempotencyKey.safeParse("a".repeat(16)).success, true);
  assert.equal(IdempotencyKey.safeParse("a".repeat(128)).success, true);
  for (const value of ["", "a".repeat(15), "a".repeat(129), "带中文" + "a".repeat(15), "a".repeat(15) + "!"]) {
    assert.equal(IdempotencyKey.safeParse(value).success, false);
  }
});

test("请求摘要保留规范化字段、明细顺序、null 与 0", () => {
  const same = { ...input, items: [{ ...input.items[0], name: " 施工 ", note: "  " }] };
  assert.equal(canonicalizeQuoteSubmission(input), canonicalizeQuoteSubmission(same));
  assert.equal(hashQuoteSubmission(input), hashQuoteSubmission(same));
  assert.notEqual(hashQuoteSubmission(input), hashQuoteSubmission({ ...input, items: [{ ...input.items[0], unitPriceCents: null }] }));
  assert.notEqual(hashQuoteSubmission(input), hashQuoteSubmission({ ...input, items: [{ ...input.items[0], unitPriceCents: 0 }] }));
  assert.notEqual(hashQuoteSubmission(input), hashQuoteSubmission({ ...input, items: [{ ...input.items[0], code: "other" }] }));
});

test("从请求头读取幂等键，不从请求体猜测", () => {
  const valid = new Request("http://localhost/api/quote", { headers: { "Idempotency-Key": "a".repeat(16) } });
  assert.equal(readIdempotencyKey(valid), "a".repeat(16));
  assert.equal(readIdempotencyKey(new Request("http://localhost/api/quote")), null);
  assert.equal(readIdempotencyKey(new Request("http://localhost/api/quote", { headers: { "Idempotency-Key": "invalid" } })), null);
});

test("事务账号绑定必须同时匹配会话、角色、绑定和服务方记录", () => {
  assert.equal(authorizeProviderAccount(session, { role: "provider", providerId: "provider-1", providerExists: true }).ok, true);
  for (const binding of [
    { role: "owner" as const, providerId: "provider-1", providerExists: true },
    { role: "provider" as const, providerId: "provider-2", providerExists: true },
    { role: "provider" as const, providerId: "provider-1", providerExists: false },
  ]) assert.equal(authorizeProviderAccount(session, binding).ok, false);
});

test("报价授权只允许 live published 非演示需求，城市不是当前授权条件", () => {
  assert.equal(authorizeProviderQuote(identity, demand).ok, true);
  assert.equal(authorizeProviderQuote(identity, { ...demand, city: "广州" }).ok, true);
  assert.equal(authorizeProviderQuote(identity, { ...demand, id: "demo-demand", source: "mock" }).ok, false);
  assert.equal(authorizeProviderQuote(identity, { ...demand, source: undefined }).ok, false);
  assert.equal(authorizeProviderQuote(identity, { ...demand, status: "contracted" }).ok, false);
});

test("首次报价与同摘要回执重放共用当前授权，非 published 状态一律为 INVALID_STATE", () => {
  for (const status of ["draft", "contracted", "in_progress", "completed"] as const) {
    const result = authorizeProviderQuote(identity, { ...demand, status });
    assert.equal(result.ok, false, status);
    if (!result.ok) {
      assert.equal(result.status, 409, status);
      assert.equal(result.code, "INVALID_STATE", status);
    }
  }
  assert.deepEqual(authorizeProviderQuote(identity, demand), { ok: true, identity });
});

test("数据库边界单独收紧，公共 Money 仍可表达安全整数", () => {
  assert.equal(DatabaseInt.safeParse(-2_147_483_648).success, true);
  assert.equal(DatabaseInt.safeParse(2_147_483_647).success, true);
  assert.equal(DatabaseInt.safeParse(2_147_483_648).success, false);
  assert.equal(DatabaseMoney.safeParse(-1).success, false);
  assert.equal(DatabaseMoney.safeParse(2_147_483_647).success, true);
});

test("apiPost 透传幂等请求头并保留 JSON content type", async (t) => {
  const responseSchema = z.object({ accepted: z.boolean() });
  const fetchMock = t.mock.method(globalThis, "fetch", async (_input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Idempotency-Key"), "a".repeat(16));
    assert.equal(headers.get("content-type"), "application/json");
    return Response.json({ ok: true, data: { accepted: true }, meta: { source: "live" } });
  });
  await apiPost("/api/quote", input, responseSchema, { headers: { "Idempotency-Key": "a".repeat(16) } });
  assert.equal(fetchMock.mock.callCount(), 1);
});
