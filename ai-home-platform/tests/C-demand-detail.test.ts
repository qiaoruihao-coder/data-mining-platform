import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { DemandDetailContent } from "../src/features/c/DemandDetail";
import { DemandHallContent } from "../src/features/c/DemandHall";
import { demandDetailFailureState, loadDemandDetail, type DemandDetailState } from "../src/features/c/demand-detail";

// 测试专用模拟记录；运行中的页面只读取公共接口。
const demand = Demand.parse({
  id: "C-detail-test", description: "测试模拟需求：厨房改造\n保留原有橱柜。", city: "深圳",
  areaM2: 25.5, budgetMinCents: 0, budgetMaxCents: 3000050,
  renovationType: "partial", desiredDays: 15, status: "published",
});

function payload(data = demand, source: "mock" | "live" = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: DemandDetailState, demandId = demand.id) {
  return renderToStaticMarkup(createElement(DemandDetailContent, { demandId, state, onReload() {} }));
}

test("详情按 ID 调用单条接口，保留各自内容与来源，不查询混合列表", async (t) => {
  const records = [payload(demand), payload({ ...demand, id: "C-live-test", city: "广州" }, "live")];
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string) => {
    const record = records.find((entry) => path === `/api/demand/${entry.data.id}`);
    assert.ok(record, `不应读取列表或其他路径：${path}`);
    return Response.json(record);
  });
  for (const record of records) assert.deepEqual(await loadDemandDetail(record.data.id), record);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("拒绝不同 ID 的有效响应，不回退到 demo、不忽略大小写或空白", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload(demand)));
  for (const id of ["demo-demand", "C-detail", "c-detail-test", ` ${demand.id}`]) {
    await assert.rejects(loadDemandDetail(id), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      const html = render(demandDetailFailureState(error), id);
      assert.match(html, /需求详情加载失败/);
      assert.doesNotMatch(html, /<article|<form|来源：/);
      return true;
    });
  }
});

test("草稿仍不展示字段或报价表单，区别于 404 并保留来源", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload({ ...demand, status: "draft" }, "live")));
  const response = await loadDemandDetail(demand.id);
  assert.equal(response.data, null);
  const html = render({ status: "ready", response });
  for (const text of ["当前需求暂不可报价", "不是已发布状态", "返回需求大厅", "刷新详情", "已保存记录"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<article|测试模拟需求|<form|需求不存在|当前列表/);
});

test("接口授权的接单详情展示真实状态、独立来源和只读信息，不再开放报价", async (t) => {
  for (const [status, label] of [["contracted", "已建立接单关系"], ["in_progress", "进行中"], ["completed", "已完成"]] as const) {
    const record = { ...demand, status, source: "live" as const };
    const fetchMock = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, `/api/demand/${demand.id}`);
      assert.equal(init, undefined);
      return Response.json(payload(record, "mock"));
    });
    const response = await loadDemandDetail(demand.id);
    assert.deepEqual(response.data, record);
    const html = render({ status: "ready", response });
    for (const text of [label, demand.description, demand.city, "25.5 平方米", "0.00", "30,000.50", "15 天",
      "含模拟数据", "已保存需求", "当前需求仅供查看", "返回我的接单",
      "不代表签署法律合同、付款或施工验收", 'href="/provider/orders"']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /<form|id="quote-form-title"|本入口不展示详情|>已发布<|需求不存在|读取权限尚未开放/);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test("404 DEMAND_NOT_FOUND 展示不存在或不可查看，不伪造来源或成功详情", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
    ok: false, error: { code: "DEMAND_NOT_FOUND", message: "需求不存在。" },
  }, { status: 404 }));
  await assert.rejects(loadDemandDetail("missing-demand"), (error: unknown) => {
    const state = demandDetailFailureState(error);
    assert.deepEqual(state, { status: "not-found" });
    const html = render(state, "missing-demand");
    for (const text of ["需求不存在或不可查看", "可能已删除", "返回需求大厅", "刷新详情"]) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /<article|<form|来源：|暂不可报价|加载失败/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("已发布详情展示公共字段、分转元、mock 来源和本地报价入口", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload()));
  const html = render({ status: "ready", response: await loadDemandDetail(demand.id) });
  for (const text of [
    demand.id, demand.description, demand.city, "局部改造", "25.5 平方米", "0.00", "30,000.50", "15 天", "已发布",
    "含模拟数据", "需求来源待确认", "不代表真实客户需求", "角色导航不代表登录鉴权",
    "登录服务方后可提交报价", "业主确认后才能接单", "业主确认后才能接单", "演示报价会标注为模拟", "账号登录不等于资质认证", "填写报价", "未提交的内容不会保存",
  ]) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/provider"/);
  assert.match(html, /<form/);
  assert.doesNotMatch(html, />已建立接单关系<|>进行中<|>已完成<|当前需求仅供查看|报价成功|真实接单流程仍待完成|详情从当前需求列表中读取|固定演示数据/);
});

test("live 详情不因列表包含 demo 而标成 mock，空描述有占位且文本安全转义", async (t) => {
  for (const description of ["", "<script>alert('test')</script>"]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(payload({ ...demand, description }, "live")));
    const html = render({ status: "ready", response: await loadDemandDetail(demand.id) });
    assert.match(html, /已保存记录/);
    assert.match(html, /数据来源标识不代表已完成身份鉴权/);
    assert.doesNotMatch(html, /接口来源：模拟标识|<script/);
    assert.match(html, description ? /&lt;script&gt;/ : /业主暂未填写需求描述/);
    fetchMock.mock.restore();
  }
});

test("大厅链接与单条请求编码特殊 ID，不再解码已解码的路由参数", async (t) => {
  const id = "测试/a?b#c%2F";
  const record = { ...demand, id };
  const response = { ...payload(), data: [record] };
  const html = renderToStaticMarkup(createElement(DemandHallContent, { state: { status: "ready", response }, onReload() {} }));
  assert.ok(html.includes(`href="/provider/demand/${encodeURIComponent(id)}"`));
  assert.match(html, /查看需求详情/);
  t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, `/api/demand/${encodeURIComponent(id)}`);
    return Response.json(payload(record));
  });
  assert.equal((await loadDemandDetail(id)).data?.id, id);
});

test("详情拒绝数组、null、无效字段、缺失来源和 HTTP 200 的失败信封", async (t) => {
  const payloads = [
    { ok: true, data: demand },
    { ...payload(), meta: { source: "unknown" } },
    { ...payload(), data: [demand] }, { ...payload(), data: null },
    payload({ ...demand, budgetMaxCents: -1 }),
    { ok: false, error: { code: "DEMAND_NOT_FOUND", message: "不存在" } },
  ];
  for (const body of payloads) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadDemandDetail(demand.id), (error: unknown) => {
      assert.equal(demandDetailFailureState(error).status, "error");
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("400、401、403、501、503 按 HTTP 状态说明问题，不当作成功或不存在", async (t) => {
  for (const [status, message] of [
    [400, "需求编号无效"], [401, "业主登录已失效"], [403, "当前身份无法查看"],
    [501, "尚未实现"], [503, "服务暂时不可用"],
  ] as const) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: false, error: { code: "TEST_ERROR", message: "不可向用户直接回显的内部详情" },
    }, { status }));
    await assert.rejects(loadDemandDetail(demand.id), (error: unknown) => {
      const html = render(demandDetailFailureState(error));
      assert.ok(html.includes(message));
      assert.match(html, /role="alert"/);
      assert.match(html, /重新加载/);
      assert.doesNotMatch(html, /<article|<form|来源：|需求不存在|内部详情/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("网络、坏 JSON、500 和不符合约定的 404 均为可重试错误，不当作空详情", async (t) => {
  const failures = [
    async () => Response.json({ ok: false }, { status: 404 }),
    async () => Response.json(payload(), { status: 500 }),
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("not json"),
    async () => new Response("not json", { status: 404 }),
  ];
  for (const failure of failures) {
    const fetchMock = t.mock.method(globalThis, "fetch", failure);
    await assert.rejects(loadDemandDetail(demand.id), (error: unknown) => {
      const html = render(demandDetailFailureState(error));
      assert.match(html, /需求详情加载失败/);
      assert.match(html, /重新加载/);
      assert.doesNotMatch(html, /<article|<form|需求不存在|来源：/);
      return true;
    });
    fetchMock.mock.restore();
  }
  assert.equal(demandDetailFailureState(new Error("HTTP 404 DEMAND_NOT_FOUND")).status, "error");
});

test("刷新重新查询最新内容，已接单移除报价入口，404 移除详情", async (t) => {
  const responses = [
    Response.json(payload()),
    Response.json(payload({ ...demand, description: "更新后的需求" }, "live")),
    Response.json(payload({ ...demand, status: "contracted" }, "live")),
    Response.json({ ok: false, error: { code: "DEMAND_NOT_FOUND", message: "不存在" } }, { status: 404 }),
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.deepEqual((await loadDemandDetail(demand.id)).data, demand);
  assert.equal((await loadDemandDetail(demand.id)).data?.description, "更新后的需求");
  const contracted = await loadDemandDetail(demand.id);
  assert.equal(contracted.data?.status, "contracted");
  const html = render({ status: "ready", response: contracted });
  assert.match(html, /当前需求仅供查看/);
  assert.doesNotMatch(html, /<form|更新后的需求/);
  await assert.rejects(loadDemandDetail(demand.id), (error: unknown) => {
    const state = demandDetailFailureState(error);
    assert.equal(state.status, "not-found");
    assert.doesNotMatch(render(state), /<article|<form|测试模拟需求|当前需求仅供查看|来源：/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 4);
});

test("加载中禁用刷新并披露演示性质，空白 ID 在请求前拒绝", async (t) => {
  const html = render({ status: "loading" });
  for (const text of ['disabled=""', 'role="status"', "正在读取需求详情", "模拟数据仅用于演示"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /<article|<form|来源：|需求不存在/);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应发送请求"); });
  for (const id of ["", " ", "\t\n"]) {
    await assert.rejects(loadDemandDetail(id), (error: unknown) => {
      assert.match(render(demandDetailFailureState(error)), /需求编号无效/);
      return true;
    });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
