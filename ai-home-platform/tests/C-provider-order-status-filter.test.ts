import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderSummary, type OrderSummaryDTO, type SourceDTO } from "../src/contracts";
import { ProviderServiceOrdersContent } from "../src/features/c/ProviderServiceOrders";
import {
  filterServiceOrders, loadProviderServiceOrders, providerServiceOrdersErrorMessage,
  summarizeServiceOrders, type ProviderServiceOrdersState, type ServiceOrderStatusFilter,
} from "../src/features/c/provider-service-orders";

// 仅测试使用合成记录；产品统计来自无参数本人接单接口，不生成订单或状态。
const records = OrderSummary.array().parse([
  { id: "order-z", demandId: "d-z", providerId: "provider-test", acceptedQuoteId: "q-z", status: "completed", source: "mock" },
  { id: "order-a", demandId: "d-a", providerId: "provider-test", acceptedQuoteId: "q-a", status: "contracted", source: "mock" },
  { id: "order-c", demandId: "需求/c?d#e", providerId: "provider-test", acceptedQuoteId: "q-c", status: "in_progress", source: "live" },
  { id: "order-b", demandId: "d-b", providerId: "provider-test", acceptedQuoteId: "q-b", status: "contracted", source: "live" },
]);
function payload(data = records, source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: ProviderServiceOrdersState, statusFilter: ServiceOrderStatusFilter = "all") {
  return renderToStaticMarkup(createElement(ProviderServiceOrdersContent, {
    state, statusFilter, onReload() {}, onStatusFilterChange() {},
  }));
}

test("同服务方多需求逐单计数，混合来源均保留，筛选不改数据或返回顺序", () => {
  const original = structuredClone(records);
  assert.deepEqual(summarizeServiceOrders(records), { total: 4, byStatus: { contracted: 2, in_progress: 1, completed: 1 } });
  for (const [status, ids] of [
    ["all", ["order-z", "order-a", "order-c", "order-b"]],
    ["contracted", ["order-a", "order-b"]], ["in_progress", ["order-c"]], ["completed", ["order-z"]],
  ] as const) {
    const visible = filterServiceOrders(records, status);
    assert.deepEqual(visible.map(order => order.id), ids);
    for (const order of visible) assert.equal(order, records.find(record => record.id === order.id));
  }
  assert.deepEqual(records, original);
});

test("状态按钮显示全量计数、单一选中态与结果数，筛选保留逐条来源和详情链接", () => {
  const html = render({ status: "ready", response: payload() }, "in_progress");
  for (const text of ["全部接单（4）", "已建立接单关系（2）", "进行中（1）", "已完成（1）",
    "显示 1 / 4 条接单", "按状态筛选订单", "刷新可查看最新进度", "清除状态筛选",
    "含模拟订单", "已保存订单", 'aria-label="按接单状态筛选"']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*>进行中（1）<\/button>/);
  assert.equal((html.match(/<article\b/g) ?? []).length, 1);
  assert.ok(html.includes(`href="/provider/demand/${encodeURIComponent(records[2].demandId)}"`));
  assert.doesNotMatch(html, /接单 order-a|接单 order-b|接单 order-z|本条接单来源：模拟|<form/);
  const cleared = render({ status: "ready", response: payload() }, "all");
  assert.match(cleared, /显示 4 \/ 4 条接单/);
  assert.equal((cleared.match(/<article\b/g) ?? []).length, 4);
  assert.doesNotMatch(cleared, /清除状态筛选/);
});

test("无匹配状态与合法全空列表明确区分，不因筛到零而改写来源或全量统计", () => {
  const noMatch = render({ status: "ready", response: payload([records[1]]) }, "completed");
  for (const text of ["当前状态下没有接单", "全部接单（1）", "已完成（0）", "显示 0 / 1 条接单", "清除状态筛选", "含模拟订单"]) assert.ok(noMatch.includes(text), text);
  assert.doesNotMatch(noMatch, /当前服务方暂无接单关系|<article|href=/);
  for (const source of ["mock", "live"] as const) {
    const empty = render({ status: "ready", response: payload([], source) }, "completed");
    for (const text of ["当前服务方暂无接单关系", "全部接单（0）", "已建立接单关系（0）", "进行中（0）", "已完成（0）", "显示 0 / 0 条接单"]) assert.ok(empty.includes(text), text);
    assert.ok(empty.includes(source === "mock" ? "含模拟订单" : "已保存订单"));
    assert.doesNotMatch(empty, /当前状态下没有接单|<article|href=/);
  }
});

test("同一筛选在刷新后跟随接口状态变化，切换筛选无需请求或写接口", async t => {
  const order = records[1];
  const statuses: OrderSummaryDTO["status"][] = ["contracted", "in_progress", "completed"];
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/provider/orders");
    assert.equal(init, undefined);
    return Response.json(payload([{ ...order, status: statuses.shift()! }]));
  });
  const first = await loadProviderServiceOrders();
  assert.match(render({ status: "ready", response: first }, "in_progress"), /当前状态下没有接单/);
  for (const filter of ["all", "contracted", "completed"] as const) render({ status: "ready", response: first }, filter);
  assert.equal(fetched.mock.callCount(), 1);
  const active = render({ status: "ready", response: await loadProviderServiceOrders() }, "in_progress");
  assert.match(active, /显示 1 \/ 1 条接单/);
  assert.match(active, /已建立接单关系（0）/);
  const done = await loadProviderServiceOrders();
  assert.match(render({ status: "ready", response: done }, "in_progress"), /当前状态下没有接单/);
  assert.match(render({ status: "ready", response: done }, "completed"), /显示 1 \/ 1 条接单/);
  assert.equal(fetched.mock.callCount(), 3);
});

test("刷新加载与失败不展示旧统计、零成功或筛选结果；501 仍失败", async t => {
  const loading = render({ status: "loading" }, "completed");
  assert.match(loading, /disabled=""/);
  assert.doesNotMatch(loading, /全部接单（|按接单状态筛选|显示 \d|<article|接单列表来源：|没有接单|暂无接单/);
  for (const status of [401, 403, 501, 503]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload(), { status }));
    await assert.rejects(loadProviderServiceOrders(), error => {
      const html = render({ status: "error", message: providerServiceOrdersErrorMessage(error) }, "completed");
      assert.match(html, /暂时无法加载本人接单/);
      if (status === 501) assert.match(html, /尚未实现/);
      assert.doesNotMatch(html, /全部接单（|按接单状态筛选|显示 \d|<article|接单列表来源：|没有接单|暂无接单/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("未选中状态中的坏记录和重复关联也拒绝整份列表，不能通过筛选掩盖", async t => {
  for (const data of [[...records, records[0]], [{ ...records[0], status: "unknown" }, records[1]]]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ ...payload(), data }));
    await assert.rejects(loadProviderServiceOrders(), error => {
      const html = render({ status: "error", message: providerServiceOrdersErrorMessage(error) }, "contracted");
      assert.match(html, /数据格式异常/);
      assert.doesNotMatch(html, /全部接单（|<article|显示 \d/);
      return true;
    });
    fetched.mock.restore();
  }
});
