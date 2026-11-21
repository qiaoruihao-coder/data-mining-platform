import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerSessionView, requestOwnerSession } from "../src/components/ui/OwnerLogin";
import { ApiClientError } from "../src/lib/api-client";

const session = { status: "signed_in", identity: { userId: "synthetic", role: "owner", providerId: null }, expiresAt: "2030-01-01T00:00:00.000Z" };
test("业主 UI 保留真实来源与错误；mock/501/错误状态不能显示已登录", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const credentials = { login: "synthetic", password: "Synthetic password 42!" };
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/auth/owner");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), credentials);
    return Response.json({ ok: true, data: session, meta: { source: "live" } });
  };
  assert.deepEqual(await requestOwnerSession("POST", credentials), session);
  for (const [status, source, data] of [[200, "mock", session], [501, "live", session], [200, "live", { status: "signed_out" }]] as const) {
    globalThis.fetch = async () => Response.json({ ok: true, data, meta: { source } }, { status });
    await assert.rejects(requestOwnerSession("POST", credentials), ApiClientError);
  }
  globalThis.fetch = async () => Response.json({ ok: false, error: { code: "INVALID_CREDENTIALS", message: "账号或密码不正确。" } }, { status: 401 });
  await assert.rejects(requestOwnerSession("POST", credentials), error => error instanceof ApiClientError && error.status === 401);
});

test("共享登录首屏和失败不声称已认证，演示导航不产生身份", () => {
  for (const state of [
    { session: null, pending: true, error: null },
    { session: null, pending: false, error: "登录失败" },
    { session: { status: "signed_out" as const }, pending: false, error: null },
  ]) {
    const html = renderToStaticMarkup(React.createElement(OwnerSessionView, { state, onAction: () => {} }));
    assert.match(html, /切换角色不会自动登录/);
    assert.doesNotMatch(html, /已登录|退出业主登录/);
  }
});
