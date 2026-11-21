import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { DemandAccessRecoveryContent } from "../src/features/c/DemandAccessRecovery";
import { DemandHallContent } from "../src/features/c/DemandHall";
import { DemandDetailContent } from "../src/features/c/DemandDetail";
import { demandHallFailureState, loadDemandHall } from "../src/features/c/demand-hall";
import { demandDetailFailureState, loadDemandDetail } from "../src/features/c/demand-detail";
import { demandRecoveryErrorMessage, exitDemandOwnerSession } from "../src/features/c/demand-access-recovery";

// 合成数据只用于测试；页面不补造需求或登录状态。
const demand = Demand.parse({ id: "C-recovery", city: "合成城市", description: "合成需求", areaM2: 1,
  budgetMinCents: 0, budgetMaxCents: 100, renovationType: "repair", desiredDays: 1, status: "published", source: "live" });
const signedOut = { ok: true, data: { status: "signed_out" }, meta: { source: "live" } };
function pages(error: unknown) {
  return [
    renderToStaticMarkup(createElement(DemandHallContent, { state: demandHallFailureState(error), onReload() {} })),
    renderToStaticMarkup(createElement(DemandDetailContent, { demandId: demand.id, state: demandDetailFailureState(error), onReload() {} })),
  ];
}

test("需求读取的 401/403 提供显式退出入口，不执行退出或展示需求/报价", async t => {
  for (const [status, code, message] of [[401, "UNAUTHENTICATED", "业主登录已失效"], [403, "FORBIDDEN", "当前身份无法查看"]] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: false, error: { code, message: "internal credential detail" },
    }, { status }));
    for (const load of [loadDemandHall, () => loadDemandDetail(demand.id)]) {
      await assert.rejects(load(), error => {
        for (const html of pages(error)) {
          assert.ok(html.includes(message));
          assert.match(html, /退出业主会话并刷新页面/);
          assert.match(html, /退出当前浏览器的业主登录并刷新本页/);
          assert.match(html, /演示服务方登录不受影响/);
          assert.doesNotMatch(html, /<article|<form|来源：|暂无已发布需求|合成需求|internal credential detail/);
        }
        return true;
      });
    }
    assert.equal(fetched.mock.callCount(), 2);
    assert.ok(fetched.mock.calls.every(call => call.arguments[1] === undefined));
    fetched.mock.restore();
  }
});

test("其他失败和伪造错误文本不能触发退出入口，501/503 不变为空成功", () => {
  for (const error of [
    new ApiClientError("secret", "INVALID_RESPONSE", 401),
    new ApiClientError("secret", "HTTP_403", 403),
    new ApiClientError("secret", "NOT_IMPLEMENTED", 501),
    new ApiClientError("secret", "DATABASE_UNAVAILABLE", 503),
    new ApiClientError("secret", "NETWORK_ERROR", 0),
    new ApiClientError("secret", "DEMAND_NOT_FOUND", 404),
    new Error("HTTP 401 UNAUTHENTICATED HTTP 501"),
  ]) {
    for (const html of pages(error)) {
      assert.doesNotMatch(html, /退出业主会话并刷新页面|<article|<form|来源：|暂无已发布需求|secret/);
    }
  }
  assert.match(demandHallFailureState(new ApiClientError("", "HTTP_501", 501)).message, /尚未实现/);
  assert.match(demandHallFailureState(new ApiClientError("", "DATABASE_UNAVAILABLE", 503)).message, /服务暂时不可用/);
  assert.match(demandHallFailureState(new Error("HTTP 501")).message, /需求列表加载失败/);
});

test("仅显式调用后向现有业主退出接口发 DELETE，不自报身份，不操作服务方会话", async t => {
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/auth/owner");
    assert.equal(init?.method, "DELETE");
    assert.equal(init?.body, undefined);
    assert.equal(init?.headers, undefined);
    return Response.json(signedOut);
  });
  assert.equal(await exitDemandOwnerSession(), undefined);
  assert.equal(fetched.mock.callCount(), 1);
});

test("退出回执必须明确 live + signed_out，模拟、缺来源、仍登录或坏信封均失败", async t => {
  const signedIn = { status: "signed_in", identity: { userId: "synthetic-owner", role: "owner", providerId: null },
    expiresAt: "2026-11-14T12:00:00.000Z" };
  for (const body of [
    { ...signedOut, meta: { source: "mock" } }, { ok: true, data: signedOut.data },
    { ...signedOut, data: signedIn }, { ...signedOut, data: null },
    { ok: false, error: { code: "UNAUTHENTICATED", message: "secret" } },
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(exitDemandOwnerSession(), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.match(demandRecoveryErrorMessage(error), /无法确认.*未自动刷新/);
      assert.doesNotMatch(demandRecoveryErrorMessage(error), /secret/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("退出遇到 403/501/503、网络中断或非 JSON 不宣称成功，也允许再次显式重试", async t => {
  const failures = [
    { send: async () => Response.json(signedOut, { status: 501 }), expected: /尚未实现/ },
    { send: async () => new Response("not json", { status: 501 }), expected: /尚未实现/ },
    { send: async () => Response.json({ ok: false }, { status: 403 }), expected: /未获允许/ },
    { send: async () => Response.json({ ok: false }, { status: 503 }), expected: /无法确认/ },
    { send: async () => { throw new Error("network secret"); }, expected: /无法确认/ },
    { send: async () => new Response("not json"), expected: /无法确认/ },
  ];
  for (const { send, expected } of failures) {
    const fetched = t.mock.method(globalThis, "fetch", send);
    await assert.rejects(exitDemandOwnerSession(), error => {
      assert.match(demandRecoveryErrorMessage(error), expected);
      assert.doesNotMatch(demandRecoveryErrorMessage(error), /network secret/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => Response.json(signedOut));
  await exitDemandOwnerSession();
});

test("恢复操作等待时禁用按钮，失败显示中性错误并恢复重试入口", () => {
  const pending = renderToStaticMarkup(createElement(DemandAccessRecoveryContent, { state: { status: "pending" }, onExit() {} }));
  assert.match(pending, /disabled=""/);
  assert.match(pending, /role="status"/);
  assert.match(pending, /确认成功后才刷新/);
  const failed = renderToStaticMarkup(createElement(DemandAccessRecoveryContent, {
    state: { status: "error", message: demandRecoveryErrorMessage(new Error("network")) }, onExit() {},
  }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /退出业主会话并刷新页面/);
  assert.doesNotMatch(failed, /disabled=""/);
});

test("退出成功后仍以需求接口授权结果为准，公开详情可读取，私有详情仍为 404", async t => {
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return Response.json(signedOut);
    if (path === `/api/demand/${demand.id}`) return Response.json({ ok: true, data: demand, meta: { source: "live" } });
    return Response.json({ ok: false, error: { code: "DEMAND_NOT_FOUND", message: "不可查看" } }, { status: 404 });
  });
  await exitDemandOwnerSession();
  assert.equal((await loadDemandDetail(demand.id)).data?.id, demand.id);
  await assert.rejects(loadDemandDetail("private-demand"), error => {
    assert.deepEqual(demandDetailFailureState(error), { status: "not-found" });
    return true;
  });
  assert.equal(fetched.mock.callCount(), 3);
});
