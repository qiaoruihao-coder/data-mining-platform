import test from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderProgressInput, type OrderSummaryDTO, type ScheduleDTO } from "../src/contracts";
import { ScheduleContent, SchedulePanel } from "../src/features/a/SchedulePanel";
import type { ScheduleState } from "../src/features/a/useSchedule";
import { OrderProgressPanel } from "../src/features/a/OrderProgressPanel";
import {
  availableProgressActions,
  buildOrderProgressInput,
  orderProgressErrorMessage,
} from "../src/features/a/order-progress";
import { loadOrderProgressHistory } from "../src/features/a/order-progress-history";
import { OrderProgressHistoryPanel } from "../src/features/a/OrderProgressHistoryPanel";
import { ApiClientError } from "../src/lib/api-client";

Object.defineProperty(globalThis, "React", { configurable: true, value: React });

const order = (status: OrderSummaryDTO["status"]): OrderSummaryDTO => ({
  id: "order-1", demandId: "demand-1", providerId: "provider-a", acceptedQuoteId: "quote-1", status, source: "mock",
});
const schedule = (statuses: ScheduleDTO["tasks"][number]["status"][], demandId = "demand-1"): ScheduleDTO => ({
  demandId, version: 3,
  tasks: statuses.map((status, index) => ({
    id: `task-${index}`, name: `工序${index + 1}`, startDay: index, durationDays: 1,
    dependsOn: index === 0 ? [] : [`task-${index - 1}`], responsibleProviderId: "provider-a", status,
  })),
});

test("选择履约动作后重渲染仍显示确认，取消不发送请求", (t) => {
  const state: unknown[] = [];
  let cursor = 0;
  // 模拟组件两次渲染之间保留 hook 状态；动作列表由真实组件重新计算。
  t.mock.method(React, "useState", (initial: unknown) => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (value: unknown) => { state[index] = value; }];
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("未经确认不能请求"); });
  const render = (currentOrder: OrderSummaryDTO, currentSchedule: ScheduleDTO | null) => {
    cursor = 0;
    return OrderProgressPanel({ demandId: "demand-1", order: currentOrder, schedule: currentSchedule, source: "live", reload() {} });
  };
  const findClick = (node: React.ReactNode, label: string): (() => void) | undefined => {
    for (const child of React.Children.toArray(node)) {
      if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(child)) continue;
      if (child.props.children === label && child.props.onClick) return child.props.onClick;
      const nested = findClick(child.props.children, label);
      if (nested) return nested;
    }
  };
  for (const [currentOrder, currentSchedule] of [
    [order("contracted"), schedule(["pending"])],
    [order("in_progress"), schedule(["done", "pending"])],
    [order("in_progress"), schedule(["done", "active"])],
    [order("in_progress"), schedule(["done", "done"])],
  ] as const) {
    state.length = 0;
    let tree = render(currentOrder, currentSchedule);
    const select = findClick(tree, "先查看确认");
    assert.ok(select);
    select();
    tree = render(currentOrder, currentSchedule);
    assert.match(renderToStaticMarkup(tree), /请再次确认/);
    assert.ok(findClick(tree, "确认并发送"));
    const cancel = findClick(tree, "取消");
    assert.ok(cancel);
    cancel();
    tree = render(currentOrder, currentSchedule);
    assert.doesNotMatch(renderToStaticMarkup(tree), /请再次确认/);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("严格按接单状态和前置工序筛选动作", () => {
  assert.deepEqual(availableProgressActions(order("contracted"), schedule(["pending"])).map(item => item.action), ["start"]);
  assert.deepEqual(availableProgressActions(order("in_progress"), schedule(["done", "pending"])).map(item => item.taskId), ["task-1"]);
  assert.deepEqual(availableProgressActions(order("in_progress"), schedule(["done", "active"])).map(item => item.action), ["complete_task"]);
  assert.deepEqual(availableProgressActions(order("in_progress"), schedule(["done", "done"])).map(item => item.action), ["complete"]);
  assert.deepEqual(availableProgressActions(order("contracted"), schedule(["active"])), []);
});

test("输入始终使用当前排期版本、confirmed true 和公共契约", () => {
  const input = buildOrderProgressInput("demand-1", "order-1", schedule(["done", "active"]), { action: "complete_task", taskId: "task-1" });
  assert.deepEqual(input, { demandId: "demand-1", orderId: "order-1", confirmed: true, scheduleVersion: 3, action: "complete_task", taskId: "task-1" });
  assert.equal(OrderProgressInput.safeParse(input).success, true);
  const noSchedule = buildOrderProgressInput("demand-1", "order-1", null, { action: "start" });
  assert.equal(noSchedule.scheduleVersion, null);
});

test("409、503、网络错误和 501 都保留为未确认结果", () => {
  assert.match(orderProgressErrorMessage(new ApiClientError("conflict", "SCHEDULE_VERSION_CONFLICT", 409)), /没有自动重发/);
  assert.match(orderProgressErrorMessage(new ApiClientError("unavailable", "TEMPORARY_UNAVAILABLE", 503)), /重新加载/);
  assert.match(orderProgressErrorMessage(new ApiClientError("not ready", "NOT_IMPLEMENTED", 501)), /没有当作成功/);
  assert.match(orderProgressErrorMessage(new ApiClientError("network", "NETWORK_ERROR", 0)), /没有自动重发/);
});

test("订单状态显示中文，不直接暴露英文枚举", () => {
  const html = renderToStaticMarkup(createElement(OrderProgressPanel, {
    demandId: "demand-1",
    order: order("in_progress"),
    schedule: null,
    source: "live",
    reload() {},
  }));
  assert.match(html, /当前状态 施工中/);
  assert.doesNotMatch(html, /当前状态 in_progress/);
});

test("真实需求没有排期时仍显示履约推进和确认开工", () => {
  const state: ScheduleState = { phase: "missing", data: null, source: null, error: null };
  const html = renderToStaticMarkup(createElement(ScheduleContent, {
    id: "demand-1",
    state,
    reload() {},
    orderState: { phase: "ready", order: order("contracted"), source: "live" },
    reloadOrder() {},
  }));
  assert.match(html, /履约推进/);
  assert.match(html, /确认开工/);
});

test("演示排期显示演示只读，不出现接单读取失败", () => {
  const state: ScheduleState = {
    phase: "ready",
    source: "mock",
    error: null,
    data: schedule(["pending"], "demo-demand"),
  };
  const html = renderToStaticMarkup(createElement(ScheduleContent, {
    id: "demo-demand",
    state,
    reload() {},
    orderState: { phase: "failed", error: "请先登录业主账号，才能读取本人接单。" },
    reloadOrder() {},
  }));
  assert.match(html, /演示只读/);
  assert.doesNotMatch(html, /接单读取失败|请先登录业主账号/);
});

test("履约记录按公共契约读取并按动作显示中文说明与来源", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "/api/order/progress?demandId=demand%2F1%3F%26");
    assert.equal(init, undefined);
    return Response.json({
    ok: true,
    data: [{
      id: "event-1", orderId: "order-1", action: "start_task", fromStatus: "in_progress",
      toStatus: "in_progress", taskId: "task-0", scheduleVersion: 2,
      createdAt: "2026-11-15T09:30:00+08:00", source: "live",
    }],
    meta: { source: "live" },
  }); });
  const state = await loadOrderProgressHistory("demand/1?&");
  assert.equal(state.phase, "ready");
  if (state.phase === "ready") {
    assert.equal(state.events[0]?.action, "start_task");
    const html = renderToStaticMarkup(createElement(OrderProgressHistoryPanel, {
      state,
      onReload() {},
    }));
    assert.match(html, /履约记录/);
    assert.match(html, /开始工序/);
    assert.match(html, /工序编号：task-0/);
    assert.match(html, /关联排期：v2/);
    assert.match(html, /2026-11-15 09:30:00\+08:00/);
    assert.match(html, /实际记录/);
    assert.match(html, /施工中/);
    assert.doesNotMatch(html, /start_task|in_progress/);
  }
  t.mock.restoreAll();
});

test("履约记录 401 提示登录与重试，不显示空记录", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "请登录" } }, { status: 401 }));
  const state = await loadOrderProgressHistory("demand-1");
  assert.deepEqual(state, { phase: "failed", error: "请先登录业主账号，才能读取履约记录。" });
  const html = renderToStaticMarkup(createElement(OrderProgressHistoryPanel, { state, onReload() {} }));
  assert.match(html, /请先登录业主账号/);
  assert.match(html, /重新加载记录/);
  assert.doesNotMatch(html, /暂无履约记录/);
  t.mock.restoreAll();
});

test("履约记录只在成功空响应时显示暂无，可重新查询恢复", async (t) => {
  let unavailable = true;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => unavailable
    ? Response.json({ ok: true, data: [], meta: { source: "live" } }, { status: 503 })
    : Response.json({ ok: true, data: [], meta: { source: "live" } }));
  assert.equal((await loadOrderProgressHistory("")).phase, "failed");
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal((await loadOrderProgressHistory("demand-1")).phase, "failed");
  unavailable = false;
  const state = await loadOrderProgressHistory("demand-1");
  assert.equal(state.phase, "ready");
  const html = renderToStaticMarkup(createElement(OrderProgressHistoryPanel, { state, onReload() {} }));
  assert.match(html, /暂无履约记录/);
  assert.match(html, /刷新记录/);
  const loading = renderToStaticMarkup(createElement(OrderProgressHistoryPanel, { state: { phase: "loading" }, onReload() {} }));
  assert.match(loading, /模拟/);
  assert.doesNotMatch(loading, /暂无履约记录/);
});

test("履约记录拒绝非成功状态、错误格式和网络失败", async (t) => {
  for (const status of [403, 404, 501, 503]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: [], meta: { source: "live" } }, { status }));
    assert.equal((await loadOrderProgressHistory("demand-1")).phase, "failed", `HTTP ${status}`);
    t.mock.restoreAll();
  }
  for (const payload of [
    { ok: true, data: [], meta: { source: "unknown" } },
    { ok: true, data: [{ action: "start" }], meta: { source: "live" } },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    assert.equal((await loadOrderProgressHistory("demand-1")).phase, "failed");
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
  assert.equal((await loadOrderProgressHistory("demand-1")).phase, "failed");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("network"); });
  assert.equal((await loadOrderProgressHistory("demand-1")).phase, "failed");
});

test("履约记录保持返回顺序、逐条来源与排期版本，不猜测工序名称", async (t) => {
  const base = { orderId: "order-1", createdAt: "2026-11-15T01:30:00.123Z" };
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, meta: { source: "mock" }, data: [
    { ...base, id: "e4", action: "start", fromStatus: "contracted", toStatus: "in_progress", taskId: null, scheduleVersion: null, source: "mock" },
    { ...base, id: "e3", action: "start_task", fromStatus: "in_progress", toStatus: "in_progress", taskId: "old-task", scheduleVersion: 2, source: "live" },
    { ...base, id: "e2", action: "complete_task", fromStatus: "in_progress", toStatus: "in_progress", taskId: "old-task", scheduleVersion: 3, source: "mock" },
    { ...base, id: "e1", action: "complete", fromStatus: "in_progress", toStatus: "completed", taskId: null, scheduleVersion: 4, source: "live" },
  ] }));
  const state = await loadOrderProgressHistory("demand-1");
  assert.equal(state.phase, "ready");
  const html = renderToStaticMarkup(createElement(OrderProgressHistoryPanel, { state, onReload() {} }));
  const actions = ["确认开工", "开始工序", "确认工序完成", "确认完工"];
  for (let i = 1; i < actions.length; i++) assert.ok(html.indexOf(actions[i - 1]) < html.indexOf(actions[i]));
  assert.match(html, /来源：模拟数据/);
  assert.match(html, /来源：实际记录/);
  assert.match(html, /01:30:00.123Z/);
  assert.match(html, /工序编号：old-task/);
  assert.doesNotMatch(html, /工序1|关联排期：vnull/);
});

test("最新真实需求在排期加载时独立展示履约记录，演示需求不读取私人历史", () => {
  const html = renderToStaticMarkup(createElement(SchedulePanel, { id: "demand-1" }));
  assert.match(html, /履约记录/);
  const demo = renderToStaticMarkup(createElement(SchedulePanel, { id: "demo-demand" }));
  assert.doesNotMatch(demo, /履约记录/);
});
