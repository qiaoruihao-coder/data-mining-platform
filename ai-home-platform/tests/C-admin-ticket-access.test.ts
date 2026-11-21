import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ticket } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { AdminTicketsContent } from "../src/features/c/AdminTickets";
import { DemandAccessRecoveryContent } from "../src/features/c/DemandAccessRecovery";
import { adminTicketsFailureState, loadAdminTickets, type AdminTicketsState } from "../src/features/c/admin-tickets";
import { demandRecoveryErrorMessage, exitDemandOwnerSession } from "../src/features/c/demand-access-recovery";

const render = (state: AdminTicketsState) => renderToStaticMarkup(createElement(AdminTicketsContent, { state, onReload() {} }));
// Test-only synthetic ticket. Runtime data still comes exclusively from the shared API.
const ticket = Ticket.parse({ id: "C-access-ticket", demandId: "C-access-demand", description: "合成工单",
  category: "quality", responsibleProviderId: null, status: "open" });
const mockList = { ok: true, data: [ticket], meta: { source: "mock" } };
const signedOut = { ok: true, data: { status: "signed_out" }, meta: { source: "live" } };

test("工单 401/403 明确指向业主会话，提供显式恢复且不自动退出", async t => {
  for (const [status, code, message] of [
    [401, "UNAUTHENTICATED", "业主登录已失效"], [403, "FORBIDDEN", "业主账号权限可能已变更"],
  ] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, "/api/ticket");
      assert.equal(init, undefined);
      return Response.json({ ok: false, error: { code, message: "internal credential detail" } }, { status });
    });
    await assert.rejects(loadAdminTickets(), error => {
      const state = adminTicketsFailureState(error);
      assert.equal(state.canExitOwnerSession, true);
      const html = render(state);
      for (const text of [message, "退出业主会话并刷新页面", "演示服务方登录不受影响",
        "退出不会获得平台管理权限", "也不会开放真实工单", "以重新查询结果为准", "重新加载"]) {
        assert.ok(html.includes(text), text);
      }
      assert.doesNotMatch(html, /请完成平台管理身份验证|公开需求浏览|internal credential detail|<article|工单列表来源：|本次返回 \d+ 条工单/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("未知或不匹配的认证错误、网络及服务失败不提供退出动作", () => {
  for (const error of [
    new ApiClientError("secret", "INVALID_RESPONSE", 401),
    new ApiClientError("secret", "HTTP_403", 403),
    new ApiClientError("secret", "FORBIDDEN", 401),
    new ApiClientError("secret", "UNAUTHENTICATED", 403),
    new ApiClientError("secret", "UNAUTHENTICATED", 200),
    new ApiClientError("secret", "FORBIDDEN", 503),
    new ApiClientError("secret", "NOT_IMPLEMENTED", 501),
    new ApiClientError("secret", "NOT_FOUND", 404),
    new ApiClientError("secret", "NETWORK_ERROR", 0),
    new Error("HTTP 401 UNAUTHENTICATED secret"),
  ]) {
    const state = adminTicketsFailureState(error);
    assert.equal(state.canExitOwnerSession, false);
    const html = render(state);
    assert.match(html, /重新加载/);
    assert.doesNotMatch(html, /退出业主会话并刷新页面|请完成平台管理身份验证|<article|工单列表来源：|secret/);
  }
});

test("401/403 非 JSON 或成功信封不是已确认的业主会话错误", async t => {
  for (const status of [401, 403]) {
    for (const response of [new Response("bad json", { status }), Response.json(mockList, { status })]) {
      const fetched = t.mock.method(globalThis, "fetch", async () => response);
      await assert.rejects(loadAdminTickets(), error => {
        assert.equal(adminTicketsFailureState(error).canExitOwnerSession, false);
        assert.doesNotMatch(render(adminTicketsFailureState(error)), /退出业主会话并刷新页面|<article/);
        return true;
      });
      fetched.mock.restore();
    }
  }
});

test("工单恢复等待时禁用操作，失败保留重试和权限边界", () => {
  const pending = renderToStaticMarkup(createElement(DemandAccessRecoveryContent, {
    context: "admin-tickets", state: { status: "pending" }, onExit() {},
  }));
  assert.match(pending, /disabled=""/);
  assert.match(pending, /确认成功后才刷新/);
  assert.match(pending, /退出不会获得平台管理权限/);
  const failed = renderToStaticMarkup(createElement(DemandAccessRecoveryContent, {
    context: "admin-tickets", state: { status: "error", message: demandRecoveryErrorMessage(new Error("secret")) }, onExit() {},
  }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /未自动刷新/);
  assert.match(failed, /退出业主会话并刷新页面/);
  assert.doesNotMatch(failed, /disabled=""|secret|公开需求浏览/);
});

test("退出失败或模拟退出回执不会当成功，501 即使成功信封仍失败", async t => {
  for (const response of [
    Response.json(signedOut, { status: 501 }),
    Response.json({ ...signedOut, meta: { source: "mock" } }),
    Response.json({ ok: true, data: { status: "signed_out" } }),
    Response.json({ ok: false, error: { code: "FORBIDDEN", message: "secret" } }, { status: 403 }),
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(exitDemandOwnerSession(), error => {
      assert.match(demandRecoveryErrorMessage(error), /无法确认/);
      if (response.status === 501) assert.match(demandRecoveryErrorMessage(error), /尚未实现/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("显式退出只调用业主 DELETE，重新查询仍保留模拟工单来源", async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/auth/owner" && init?.method === "DELETE") {
      assert.equal(init.body, undefined);
      return Response.json(signedOut);
    }
    assert.equal(path, "/api/ticket");
    assert.equal(init, undefined);
    return Response.json(mockList);
  });
  await exitDemandOwnerSession();
  const html = render({ status: "ready", response: await loadAdminTickets() });
  assert.deepEqual(requests, ["DELETE /api/auth/owner", "GET /api/ticket"]);
  for (const text of ["工单列表来源：含模拟数据", "不能据此认定真实售后已受理或已解决",
    "不包含全站或当前业主的真实工单", "平台管理身份认证尚未接入", "合成工单"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /退出业主会话并刷新页面|工单列表来源：实时接口/);
});

test("退出后重新查询失败仍是失败，不降级到模拟或空列表", async t => {
  t.mock.method(globalThis, "fetch", async (path: string) => path === "/api/auth/owner"
    ? Response.json(signedOut)
    : Response.json({ ok: false, error: { code: "TICKET_UNAVAILABLE", message: "secret" } }, { status: 503 }));
  await exitDemandOwnerSession();
  await assert.rejects(loadAdminTickets(), error => {
    const html = render(adminTicketsFailureState(error));
    assert.match(html, /工单服务暂时不可用/);
    assert.doesNotMatch(html, /<article|工单列表来源：|本次列表暂无工单|本次返回 \d+ 条工单|secret/);
    return true;
  });
});

test("加载中不出现恢复动作，既有需求恢复文案保持默认", () => {
  assert.doesNotMatch(render({ status: "loading" }), /退出业主会话并刷新页面|<article/);
  const html = renderToStaticMarkup(createElement(DemandAccessRecoveryContent, { state: { status: "idle" }, onExit() {} }));
  assert.match(html, /退出业主会话以恢复公开需求浏览/);
  assert.match(html, /可查看的需求以重新查询结果为准/);
  assert.doesNotMatch(html, /模拟工单|平台管理权限/);
});
