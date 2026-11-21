import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { AdminDemandOverviewContent } from "../src/features/c/AdminDemandOverview";
import {
  adminDemandErrorMessage, adminDemandFailureState, loadAdminDemands, summarizeAdminDemands, type AdminDemandState,
} from "../src/features/c/admin-demand-overview";

// 仅测试使用的模拟记录；运行页面不会生成或回退到这些记录。
const demand = Demand.parse({
  id: "C-admin-test", description: "测试需求", city: "深圳", areaM2: 20,
  budgetMinCents: 0, budgetMaxCents: 1000050, renovationType: "repair",
  desiredDays: 15, status: "published",
});
function payload(data: DemandDTO[] = [demand], source: "mock" | "live" = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: AdminDemandState) {
  return renderToStaticMarkup(createElement(AdminDemandOverviewContent, { state, onReload() {} }));
}

test("管理概览只调用公共需求 GET，保留所有状态和列表来源", async (t) => {
  const data = Demand.shape.status.options.map((status) => ({ ...demand, id: status, status }));
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/demand");
    assert.equal(init?.method, undefined);
    return Response.json(payload(data, "live"));
  });
  assert.deepEqual(await loadAdminDemands(), payload(data, "live"));
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("状态统计来自完整返回列表，包含草稿且不把已签约数量称作我的接单", () => {
  const data = Demand.shape.status.options.map((status) => Object.freeze({ ...demand, id: status, status }));
  const summary = summarizeAdminDemands(Object.freeze([...data, { ...demand, id: "another-published" }]));
  assert.deepEqual(summary, { total: 6, byStatus: { draft: 1, published: 2, contracted: 1, in_progress: 1, completed: 1 } });
  assert.equal(Object.values(summary.byStatus).reduce((sum, count) => sum + count, 0), summary.total);
  const html = render({ status: "ready", response: payload(data) });
  for (const label of ["草稿", "已发布", "已签约", "施工中", "已完成"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /我的接单|实际成交额|完成率/);
});

test("成功空列表保留来源并显示零计数，不将其描述成平台没有需求", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload([], "live")));
  const response = await loadAdminDemands();
  assert.deepEqual(summarizeAdminDemands(response.data), {
    total: 0, byStatus: { draft: 0, published: 0, contracted: 0, in_progress: 0, completed: 0 },
  });
  const html = render({ status: "ready", response });
  for (const text of ["本次列表暂无需求", "列表来源：已保存记录", "不代表平台没有历史需求", "刷新概览"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<dd[^>]*>0<\/dd>/g) ?? []).length, 6);
  assert.doesNotMatch(html, /<table|列表来源：含模拟/);
});

test("首次加载披露可能含模拟数据，不把未加载统计显示为零", () => {
  const html = render({ status: "loading" });
  for (const text of ["模拟记录已单独标注", "查看范围取决于登录账号", "正在读取需求概览", 'disabled=""', 'role="status"']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<dd|<table|本次列表暂无需求|列表来源：/);
});

test("空列表标记 mock 时只保留接口标识，不声称存在模拟记录", () => {
  const html = render({ status: "ready", response: payload([]) });
  assert.match(html, /列表来源：模拟标识（mock）/);
  assert.match(html, /本次为空列表，接口来源标记为 mock/);
  assert.match(html, /本次列表暂无需求/);
  assert.doesNotMatch(html, /列表包含模拟数据|列表来源：含模拟数据|<table/);
});

test("mock 混合列表明确来源范围，不把每条记录都认定为模拟或真实", async (t) => {
  const data = [demand, { ...demand, id: "newly-created", city: "广州" }];
  t.mock.method(globalThis, "fetch", async () => Response.json(payload(data)));
  const html = render({ status: "ready", response: await loadAdminDemands() });
  for (const text of ["列表来源：含模拟数据", "也可能包含实际创建的需求", "各条需求来源以行内标识为准", "需求来源待确认", "不代表平台全量数据", "深圳", "广州", "newly-created"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /固定演示数据|以下均为模拟|列表来源：实时接口/);
});

test("live 列表预算按分转元，期望工期不被当作实际工期或完成承诺", () => {
  const html = render({ status: "ready", response: payload([demand], "live") });
  for (const text of ["列表来源：已保存记录", "不代表已完成身份鉴权", "业主预算", "0.00", "10,000.50", "15 天", "期望工期不等于实际工期", "维修", 'scope="col"', 'scope="row"']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<form|确认完工|合同总额|列表来源：含模拟/);
});

test("列表文字安全转义，长编号可换行且表格允许局部横向滚动", () => {
  const html = render({ status: "ready", response: payload([{ ...demand, id: '<script>alert("id")</script>', city: "<img src=x onerror=alert(1)>" }]) });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.match(html, /break-all/);
  assert.match(html, /需求明细，可横向滚动/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /<script|<img/);
});

test("看板各状态需求链接到管理详情，保留并编码各自编号", () => {
  const data = Demand.shape.status.options.map((status) => ({ ...demand, id: `需求/${status} ?#%`, status }));
  const html = render({ status: "ready", response: payload(data) });
  for (const row of data) assert.ok(html.includes(`href="/admin/demand/${encodeURIComponent(row.id)}"`));
  assert.equal((html.match(/>查看需求详情<\/a>/g) ?? []).length, data.length);
  assert.doesNotMatch(html, /href="\/owner|href="\/provider/);
});

test("拒绝缺失来源、未知状态、非法金额、重复 ID 和业务失败响应", async (t) => {
  const bodies = [
    { ok: true, data: [demand] }, { ...payload(), meta: { source: "unknown" } },
    payload([{ ...demand, budgetMaxCents: -1 }]),
    { ...payload(), data: [{ ...demand, status: "unknown" }] },
    payload([demand, demand]), { ...payload(), data: null },
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "未实现" } },
  ];
  for (const body of bodies) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadAdminDemands(), (error: unknown) => {
      const html = render({ status: "error", message: adminDemandErrorMessage(error) });
      assert.match(html, /需求概览加载失败/);
      assert.doesNotMatch(html, /<dd|<table|本次列表暂无需求|列表来源：/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("401、403、501、503 明确显示失败并支持重试，不回显内部错误", async (t) => {
  for (const [status, text] of [[401, "业主登录已失效"], [403, "当前身份无法查看"], [501, "尚未实现"], [503, "暂时不可用"]] as const) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: false, error: { code: "TEST_FAILURE", message: "内部敏感错误细节" },
    }, { status }));
    await assert.rejects(loadAdminDemands(), (error: unknown) => {
      const html = render(adminDemandFailureState(error));
      for (const expected of [text, 'role="alert"', "重新加载"]) assert.ok(html.includes(expected), expected);
      assert.doesNotMatch(html, /<dd|<table|本次列表暂无需求|列表来源：|内部敏感|退出业主会话并刷新页面/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("管理概览已知业主凭证错误提供手动恢复，不自行退出或显示成功统计", async (t) => {
  for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"]] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, "/api/demand");
      assert.equal(init, undefined);
      return Response.json({ ok: false, error: { code, message: "credential secret" } }, { status });
    });
    await assert.rejects(loadAdminDemands(), error => {
      const html = render(adminDemandFailureState(error));
      assert.match(html, /退出业主会话并刷新页面/);
      assert.match(html, /退出当前浏览器的业主登录并刷新本页/);
      assert.match(html, /演示服务方登录不受影响/);
      assert.doesNotMatch(html, /<dd|<table|本次列表暂无需求|列表来源：|credential secret|请完成平台管理身份验证/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("管理概览坏回执、伪成功 501 和网络错误不提供退出入口", async (t) => {
  for (const send of [
    async () => new Response("not json", { status: 401 }),
    async () => Response.json(payload(), { status: 403 }),
    async () => Response.json(payload(), { status: 501 }),
    async () => { throw new Error("HTTP 401 UNAUTHENTICATED"); },
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", send);
    await assert.rejects(loadAdminDemands(), error => {
      const html = render(adminDemandFailureState(error));
      assert.doesNotMatch(html, /退出业主会话并刷新页面|<dd|<table|本次列表暂无需求|列表来源：/);
      if (error instanceof ApiClientError && error.status === 501) assert.match(html, /尚未实现/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("管理概览所有视图说明身份可见范围，不把管理导航或空结果当作全平台权限", () => {
  for (const state of [
    { status: "loading" }, { status: "ready", response: payload([]) },
    { status: "ready", response: payload() },
    adminDemandFailureState(new ApiClientError("", "UNAUTHENTICATED", 401)),
  ] satisfies AdminDemandState[]) {
    const html = render(state);
    for (const text of ["未登录业主时仅显示已发布的公开需求", "业主登录后仅显示本人的所有状态需求",
      "管理员专属登录与全量需求查询尚未接入", "切换角色不会扩大可见范围", "登录、退出或身份变化后", "不代表平台全量数据"]) {
      assert.ok(html.includes(text), text);
    }
  }
});

test("网络、坏 JSON、404、500 不能变成空列表或成功统计", async (t) => {
  for (const failure of [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("not json"),
    async () => Response.json({ ok: false }, { status: 404 }),
    async () => Response.json(payload(), { status: 500 }),
  ]) {
    const fetchMock = t.mock.method(globalThis, "fetch", failure);
    await assert.rejects(loadAdminDemands(), (error: unknown) => {
      assert.match(adminDemandErrorMessage(error), /加载失败/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("每次重新查询按新列表重算统计和来源，失败后重试可恢复", async (t) => {
  const responses = [
    Response.json(payload()),
    Response.json({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "不可用" } }, { status: 503 }),
    Response.json(payload([{ ...demand, status: "completed" }], "live")),
    Response.json(payload([], "live")),
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.equal(summarizeAdminDemands((await loadAdminDemands()).data).byStatus.published, 1);
  await assert.rejects(loadAdminDemands());
  const updated = await loadAdminDemands();
  assert.equal(updated.meta.source, "live");
  assert.deepEqual(summarizeAdminDemands(updated.data), {
    total: 1, byStatus: { draft: 0, published: 0, contracted: 0, in_progress: 0, completed: 1 },
  });
  assert.equal(summarizeAdminDemands((await loadAdminDemands()).data).total, 0);
  assert.equal(fetchMock.mock.callCount(), 4);
});
