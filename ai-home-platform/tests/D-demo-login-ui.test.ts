import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, type DemoProviderSessionDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { DemoProviderSessionView, requestDemoProviderSession } from "../src/components/ui/DemoProviderLogin";

const signedIn: DemoProviderSessionDTO = { status: "signed_in", demo: true,
  identity: { userId: DEMO_PROVIDER_USER_ID, providerId: DEMO_PROVIDER_ID, role: "provider" },
  expiresAt: "2026-11-14T12:30:00.000Z" };

test("演示入口展示加载、关闭、未登录、已登录及失败状态，不把导航当作登录", () => {
  const render = (session: DemoProviderSessionDTO | null, pending = false, error: string | null = null) => renderToStaticMarkup(
    React.createElement(DemoProviderSessionView, { state: { session, pending, error }, onAction: () => {} }),
  );
  for (const html of [render(null, true), render({ status: "disabled", demo: true }), render({ status: "signed_out", demo: true }), render(signedIn), render(null, false, "请求失败")]) {
    assert.match(html, /模拟身份/);
    assert.match(html, /不代表真实身份认证/);
    assert.match(html, /切换角色不会自动登录/);
  }
  assert.match(render(null, true), /disabled/);
  assert.doesNotMatch(render(null, true), /已登录：/);
  assert.match(render({ status: "disabled", demo: true }), /演示登录未开启/);
  assert.match(render({ status: "signed_out", demo: true }), />演示服务方登录<\/button>/);
  assert.match(render(signedIn), /退出演示登录/);
  assert.match(render(signedIn), /provider-a/);
  assert.match(render(null, false, "请求失败"), /role="alert"/);
  assert.doesNotMatch(render(null, false, "请求失败"), /退出演示登录|已登录：/);
});

test("客户端仅提交固定演示动作，登录/退出必须得到相符的 mock 会话回执", async t => {
  const calls: Array<{ method: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/auth/demo-provider");
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body });
    return Response.json({ ok: true, data: method === "POST" ? signedIn : { status: "signed_out", demo: true }, meta: { source: "mock" } });
  });
  assert.equal((await requestDemoProviderSession("GET")).status, "signed_out");
  assert.deepEqual(await requestDemoProviderSession("POST"), signedIn);
  assert.equal((await requestDemoProviderSession("DELETE")).status, "signed_out");
  assert.deepEqual(calls, [
    { method: "GET", body: undefined },
    { method: "POST", body: JSON.stringify({ action: "login_demo" }) },
    { method: "DELETE", body: undefined },
  ]);
});

test("非法来源、失败信封、501 伪成功与网络失败不能生成登录成功状态", async t => {
  for (const response of [
    Response.json({ ok: true, data: signedIn, meta: { source: "live" } }),
    Response.json({ ok: true, data: { ...signedIn, demo: false }, meta: { source: "mock" } }),
    Response.json({ ok: true, data: { status: "signed_out", demo: true }, meta: { source: "mock" } }),
    Response.json({ ok: false, error: { code: "SESSION_UNAVAILABLE", message: "不可用" } }, { status: 503 }),
    Response.json({ ok: true, data: signedIn, meta: { source: "mock" } }, { status: 501 }),
    new Response("bad JSON"),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(requestDemoProviderSession("POST"), ApiClientError);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network"); });
  await assert.rejects(requestDemoProviderSession("POST"), ApiClientError);
});
