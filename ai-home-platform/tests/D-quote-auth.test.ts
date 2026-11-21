import test from "node:test";
import assert from "node:assert/strict";
import { providerIdentityFailureResponse, requireProviderIdentity, type VerifiedSessionReader } from "../src/lib/server-auth";

const request = (body?: unknown) => new Request("http://localhost/api/quote", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test("没有已验证会话时返回 401，不读取请求体中的 providerId", async () => {
  const result = await requireProviderIdentity(request({ providerId: "provider-a" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.error.code, "UNAUTHENTICATED");
  }
});

test("已验证服务方会话只返回会话绑定的 providerId", async () => {
  const readSession: VerifiedSessionReader = async () => ({
    userId: "user-provider-a",
    role: "provider",
    providerId: "provider-a",
  });
  const result = await requireProviderIdentity(request({ providerId: "forged-provider" }), readSession);
  assert.deepEqual(result, {
    ok: true,
    identity: { userId: "user-provider-a", role: "provider", providerId: "provider-a" },
  });
});

test("业主、运营或未绑定服务方的会话返回 403", async () => {
  for (const session of [
    { userId: "owner-1", role: "owner", providerId: null },
    { userId: "admin-1", role: "admin", providerId: null },
    { userId: "provider-1", role: "provider", providerId: null },
  ]) {
    const result = await requireProviderIdentity(request(), async () => session);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error.code, "FORBIDDEN");
    }
  }
});

test("认证适配器输出不符合已验证会话契约时按未登录处理", async () => {
  const result = await requireProviderIdentity(request(), async () => ({
    userId: "provider-1",
    role: "provider",
    providerId: 123,
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("身份失败响应保留统一失败信封", async () => {
  const response = providerIdentityFailureResponse({
    ok: false,
    status: 403,
    error: { code: "FORBIDDEN", message: "当前身份没有服务方报价权限。" },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "FORBIDDEN", message: "当前身份没有服务方报价权限。" },
  });
});
