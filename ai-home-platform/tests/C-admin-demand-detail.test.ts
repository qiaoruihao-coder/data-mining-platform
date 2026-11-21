import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { AdminDemandDetailContent } from "../src/features/c/AdminDemandDetail";
import { adminDemandStatusLabels } from "../src/features/c/admin-demand-overview";
import { adminDemandDetailFailureState, loadAdminDemandDetail, type AdminDemandDetailState } from "../src/features/c/admin-demand-detail";

// 仅用于测试的合成记录，运行页面不生成或回退到这些记录。
const demand = Demand.parse({
  id: "C-admin-detail", description: "测试需求\n第二行描述", city: "广州", areaM2: 25.5,
  budgetMinCents: 0, budgetMaxCents: 1000050, renovationType: "repair", desiredDays: 15, status: "published",
});
function payload(data: DemandDTO = demand, source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: AdminDemandDetailState, demandId = demand.id) {
  return renderToStaticMarkup(createElement(AdminDemandDetailContent, { demandId, state, onReload() {} }));
}

test("管理详情仅按当前 ID 调用公共 GET，保留全部五种状态与来源", async (t) => {
  for (const status of Demand.shape.status.options) {
    const data = { ...demand, id: `需求/${status} ?#%`, status, source: "live" as const };
    const fetchMock = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, `/api/demand/${encodeURIComponent(data.id)}`);
      assert.equal(init?.method, undefined);
      assert.equal(init?.body, undefined);
      return Response.json(payload(data, "live"));
    });
    const response = await loadAdminDemandDetail(data.id);
    assert.deepEqual(response, payload(data, "live"));
    assert.match(render({ status: "ready", response }), new RegExp(adminDemandStatusLabels[status]));
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test("空编号在网络前拒绝，错位编号和无效成功响应不能显示详情", async (t) => {
  const noFetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应请求"); });
  for (const id of ["", " \n "]) {
    await assert.rejects(loadAdminDemandDetail(id), (error: unknown) => error instanceof ApiClientError && error.status === 400);
  }
  assert.equal(noFetch.mock.callCount(), 0);
  noFetch.mock.restore();
  for (const body of [
    payload({ ...demand, id: "different-demand" }), { ok: true, data: demand },
    { ...payload(), data: null }, { ...payload(), data: { ...demand, status: "unknown" } },
    { ...payload(), meta: { source: "unknown" } }, payload({ ...demand, budgetMaxCents: -1 }),
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "内部错误" } },
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadAdminDemandDetail(demand.id), (error: unknown) => {
      const html = render(adminDemandDetailFailureState(error));
      assert.match(html, /详情格式或编号异常/);
      assert.doesNotMatch(html, /<article|<dd|详情接口来源：|不同需求|different-demand|内部错误/);
      return true;
    });
    mock.mock.restore();
  }
});

test("明确的需求 404 显示未找到，权限、未实现和服务异常保留错误而非空成功", async (t) => {
  const cases = [
    [404, "DEMAND_NOT_FOUND", "需求不存在或不可查看", "not-found"],
    [400, "VALIDATION_ERROR", "需求编号无效", "error"],
    [401, "UNAUTHENTICATED", "业主登录已失效", "error"],
    [403, "FORBIDDEN", "当前身份无法查看", "error"],
    [501, "NOT_IMPLEMENTED", "尚未实现", "error"],
    [503, "DATABASE_UNAVAILABLE", "暂时不可用", "error"],
    [404, "ROUTE_NOT_FOUND", "加载失败", "error"],
  ] as const;
  for (const [status, code, text, expectedState] of cases) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: false, error: { code, message: "内部敏感错误" },
    }, { status }));
    await assert.rejects(loadAdminDemandDetail(demand.id), (error: unknown) => {
      const state = adminDemandDetailFailureState(error);
      assert.equal(state.status, expectedState);
      const html = render(state);
      assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /<article|<dd|详情接口来源：|内部敏感/);
      assert.ok(html.includes(expectedState === "not-found" ? "刷新详情" : "重新加载"));
      return true;
    });
    mock.mock.restore();
  }
});

test("HTTP 501 伪成功、坏 JSON、网络异常和 500 均不回退模拟需求", async (t) => {
  for (const failure of [
    async () => Response.json(payload(), { status: 501 }),
    async () => new Response("not json", { status: 501 }),
    async () => { throw new TypeError("网络中断"); },
    async () => new Response("not json"),
    async () => Response.json(payload(), { status: 500 }),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", failure);
    await assert.rejects(loadAdminDemandDetail(demand.id), (error: unknown) => {
      const state = adminDemandDetailFailureState(error);
      assert.equal(state.status, "error");
      const html = render(state);
      assert.match(html, /暂时无法加载需求详情/);
      if (error instanceof ApiClientError && error.status === 501) assert.match(html, /尚未实现/);
      assert.doesNotMatch(html, /<article|<dd|详情接口来源：|需求来源：|demo-demand/);
      return true;
    });
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("接口来源与逐条来源独立展示，缺失逐条来源保持未知", () => {
  for (const source of ["mock", "live"] as const) {
    for (const recordSource of [undefined, "mock", "live"] as const) {
      const html = render({ status: "ready", response: payload({ ...demand, source: recordSource }, source) });
      assert.ok(html.includes(source === "mock" ? "含模拟数据" : "已保存记录"));
      assert.ok(html.includes(recordSource === undefined ? "需求来源待确认"
        : recordSource === "mock" ? "模拟需求" : "已保存需求"));
      assert.match(html, /模拟需求仅供演示/);
      assert.match(html, /来源不明的记录请先核实/);
    }
  }
});

test("详情展示分转元、完整描述和期望工期，只有管理返回与刷新动作", () => {
  const html = render({ status: "ready", response: payload() });
  for (const text of ["广州", "维修", "测试需求\n第二行描述", "25.5 平方米", "0.00", "10,000.50", "15 天", "业主预算",
    "不代表成交金额、实际工期或履约完成证明", "本页仅供查看", "查看范围取决于登录账号", 'href="/admin"', 'href="/admin/tickets"']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<form|<input|<select|<textarea|href="\/owner|href="\/provider|尝试提交报价/);
});

test("加载及未找到状态不展示旧内容或提前标成功，文本安全转义且空描述有提示", () => {
  for (const state of [{ status: "loading" }, { status: "not-found" }] as const) {
    const html = render(state);
    assert.doesNotMatch(html, /<article|<dd|详情接口来源：|需求来源：|测试需求/);
    assert.match(html, /role="status"/);
    if (state.status === "loading") assert.match(html, /disabled=""/);
  }
  const html = render({ status: "ready", response: payload({
    ...demand, city: "<img src=x onerror=alert(1)>", description: "<script>alert(1)</script>\n第二行",
  }) }, "<script>id</script>");
  for (const text of ["&lt;script&gt;", "&lt;img", "whitespace-pre-wrap", "break-all", "overflow-wrap:anywhere"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script|<img/);
  const empty = render({ status: "ready", response: payload({ ...demand, description: " \n ", city: " " }) });
  assert.match(empty, /暂未填写需求描述/);
  assert.match(empty, /城市未填写/);
});

test("刷新重新获取状态与来源，失败后可读取恢复结果而不保留旧响应", async (t) => {
  const responses = [
    Response.json(payload()),
    Response.json({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "不可用" } }, { status: 503 }),
    Response.json(payload({ ...demand, status: "completed", source: "live" }, "live")),
  ];
  const mock = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.match(render({ status: "ready", response: await loadAdminDemandDetail(demand.id) }), /已发布/);
  await assert.rejects(loadAdminDemandDetail(demand.id));
  const html = render({ status: "ready", response: await loadAdminDemandDetail(demand.id) });
  assert.match(html, /已完成/);
  assert.match(html, /已保存需求/);
  assert.doesNotMatch(html, />已发布<|详情接口来源：模拟/);
  assert.equal(mock.mock.callCount(), 3);
});

test("管理详情仅对明确的业主身份错误提供恢复，404 和其他错误不触发退出", async (t) => {
  for (const [status, code, recoverable] of [
    [401, "UNAUTHENTICATED", true], [403, "FORBIDDEN", true],
    [401, "INVALID_RESPONSE", false], [403, "HTTP_403", false],
    [404, "DEMAND_NOT_FOUND", false], [501, "NOT_IMPLEMENTED", false],
    [503, "DATABASE_UNAVAILABLE", false],
  ] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, `/api/demand/${demand.id}`);
      assert.equal(init, undefined);
      return Response.json({ ok: false, error: { code, message: "credential secret" } }, { status });
    });
    await assert.rejects(loadAdminDemandDetail(demand.id), error => {
      const html = render(adminDemandDetailFailureState(error));
      assert.equal(html.includes("退出业主会话并刷新页面"), recoverable);
      assert.doesNotMatch(html, /<article|<dd|<form|详情接口来源：|credential secret|请完成平台管理身份验证|请核实平台管理权限/);
      if (recoverable) assert.match(html, /演示服务方登录不受影响/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("管理详情可见范围说明保留在成功、失败和 404 中，关联工单不代表额外权限", () => {
  for (const state of [
    { status: "loading" }, { status: "ready", response: payload() }, { status: "not-found" },
    adminDemandDetailFailureState(new ApiClientError("", "FORBIDDEN", 403)),
  ] satisfies AdminDemandDetailState[]) {
    const html = render(state);
    for (const text of ["已发布需求可公开查看", "其他需求仅限业主或接单服务方查看", "同时登录两种身份时，以业主权限为准", "运营账号暂不具备额外读取权限",
      "运营账号暂不具备额外读取权限", "切换账号后请刷新详情", "以业主权限为准", "业主登录失效时，请重新登录或退出该账号", "切换账号后请刷新详情"]) {
      assert.ok(html.includes(text), text);
    }
    assert.doesNotMatch(html, /其他状态仅所属业主登录后可读|退出业主会话后，非公开需求不可查看/);
  }
});
