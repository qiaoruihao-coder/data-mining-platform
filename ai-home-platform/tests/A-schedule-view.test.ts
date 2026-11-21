import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Schedule } from "../src/contracts";
import { ScheduleContent } from "../src/features/a/SchedulePanel";
import { ScheduleVersionControls } from "../src/features/a/ScheduleVersionControls";
import type { ScheduleState } from "../src/features/a/useSchedule";

// tsx 对 jsx:preserve 使用经典 JSX，仅在渲染测试期间提供 React。
const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

const schedule = Schedule.parse({
  demandId: "test-demand", version: 1,
  tasks: [{ id: "test-task", name: "测试工序", startDay: 2, durationDays: 3, dependsOn: [], responsibleProviderId: null, status: "done" }],
});
const ready = (source: "mock" | "live" = "mock"): ScheduleState => ({ phase: "ready", data: schedule, source, error: null });
const render = (state: ScheduleState, id = schedule.demandId, version?: number, orderState?: React.ComponentProps<typeof ScheduleContent>["orderState"]) => renderToStaticMarkup(
  createElement(ScheduleContent, { id, version, state, reload() {}, orderState }),
);

test("版本选择器标明查询模式并允许返回最新，不编造可用版本列表", () => {
  const latest = renderToStaticMarkup(createElement(ScheduleVersionControls, { onSelect() {} }));
  assert.match(latest, /排期版本号|查看指定版本/);
  assert.match(latest, /查询模式：最新排期/);
  const historical = renderToStaticMarkup(createElement(ScheduleVersionControls, { version: 2, onSelect() {} }));
  assert.match(historical, /指定版本 v2/);
  assert.match(historical, /返回最新排期/);
  assert.match(historical, /不代表最新排期或当前现场进度/);
  assert.doesNotMatch(historical, /<select|<option/);
});

test("指定版本只供查阅，保留来源和工序但隐藏当前项目操作", () => {
  const html = render(ready(), schedule.demandId, 1);
  assert.match(html, /正在查看指定版本 v1/);
  assert.match(html, /不代表当前现场进度/);
  assert.match(html, /模拟排期/);
  assert.match(html, /测试工序/);
  assert.match(html, /刷新指定版本/);
  assert.doesNotMatch(html, /刷新最新排期|申请排期变更|确认阶段验收|照片辅助检查/);
});

test("指定版本缺失不意味着需求没有排期，错位版本不展示工序", () => {
  const missing = render({ phase: "missing", data: null, source: null, error: null }, schedule.demandId, 2);
  assert.match(missing, /未找到指定版本 v2/);
  assert.match(missing, /不代表该需求没有其他排期/);
  assert.doesNotMatch(missing, /暂无排期|尚未找到这条需求的排期|progressbar/);
  const mismatch = render(ready(), schedule.demandId, 2);
  assert.match(mismatch, /排期版本不一致/);
  assert.doesNotMatch(mismatch, /测试工序|progressbar|确认阶段验收/);
});

test("指定版本的加载和空工序状态保留版本信息及来源语义", () => {
  const loading = render({ phase: "loading", data: null, source: null, error: null }, schedule.demandId, 2);
  assert.match(loading, /排期版本 v2/);
  assert.match(loading, /正在加载，模拟记录会单独标注/);
  const empty = render({ ...ready("live"), data: { ...schedule, tasks: [] } }, schedule.demandId, 1);
  assert.match(empty, /排期版本 v1/);
  assert.match(empty, /排期来源：live/);
  assert.doesNotMatch(empty, /模拟数据|确认阶段验收/);
});

test("排期 ID 不匹配时不展示他人图表、统计、工序或操作", () => {
  const html = render(ready(), "other/a?#");
  assert.match(html, /这条排期不属于当前需求/);
  assert.match(html, /不能证明当前需求没有排期/);
  assert.doesNotMatch(html, /工序时间轴|计划总工期|测试工序|申请排期变更|确认阶段验收|progressbar/);
  assert.ok(html.includes(`/owner/demand/${encodeURIComponent("other/a?#")}`));
  assert.match(html, /重新加载/);
});

test("错位空排期也必须报不匹配，不能断言当前需求没有排期", () => {
  const html = render({ ...ready(), data: { ...schedule, tasks: [] } }, "other");
  assert.match(html, /这条排期不属于当前需求/);
  assert.doesNotMatch(html, /这条需求还没有排期|接口没有返回任何工序/);
});

test("全部完成显示 100% 和完成状态，但不声称验收通过", () => {
  const html = render(ready());
  assert.match(html, /工序全部完成/);
  assert.match(html, /aria-valuenow="100"/);
  assert.match(html, /不代表验收通过/);
  assert.doesNotMatch(html, />未开工</);
  assert.match(html, /责任方：.*待指派/);
});

test("mock/live 分别披露来源，不把真实响应描述为模拟", () => {
  assert.match(render(ready()), /模拟排期/);
  const live = render(ready("live"));
  assert.match(live, /排期来源：live/);
  assert.doesNotMatch(live, /模拟数据/);
  assert.match(live, /不能据此判断今天进度或是否延期/);
  assert.match(live, /实际进场时间和现场条件仍需施工负责人确认/);
});

test("加载、失败、空排期不展示百分比或真实日期", () => {
  const loading = render({ phase: "loading", data: null, source: null, error: null });
  assert.match(loading, /正在加载，模拟记录会单独标注/);
  assert.doesNotMatch(loading, /模拟排期|排期来源：live|progressbar/);
  const failed = render({ phase: "failed", data: null, source: null, error: "HTTP 501" });
  assert.match(failed, /HTTP 501/);
  assert.match(failed, /重新加载/);
  assert.doesNotMatch(failed, /progressbar|工序全部完成/);
  const empty = render({ ...ready(), data: { ...schedule, tasks: [] } });
  assert.match(empty, /接口没有返回任何工序/);
  assert.match(empty, /排期来源：mock/);
  assert.doesNotMatch(empty, /progressbar|100%/);
});

test("有排期时返回链接仍保留编码后的原需求 ID", () => {
  const id = "需求/a?#";
  const html = render({ ...ready(), data: { ...schedule, demandId: id } }, id);
  assert.ok(html.includes(`/owner/demand/${encodeURIComponent(id)}`));
});

test("404 无排期单独显示可重试空态，不展示来源、图表或写入操作", () => {
  const html = render({ phase: "missing", data: null, source: null, error: null });
  assert.match(html, /尚未找到这条需求的排期/);
  assert.match(html, /重新加载/);
  assert.doesNotMatch(html, /接口请求失败|排期来源|模拟数据|progressbar|工序时间轴|申请排期变更/);
});

test("最新排期和空工序版本都展示接口版本，并提供刷新入口", () => {
  const state = { ...ready("live"), data: { ...schedule, version: 7 } };
  const html = render(state);
  assert.match(html, /排期版本 v7/);
  assert.match(html, /刷新最新排期/);
  const empty = render({ ...state, data: { ...state.data, tasks: [] } });
  assert.match(empty, /排期版本 v7/);
  assert.match(empty, /重新加载/);
  assert.doesNotMatch(empty, /固定演示数据|还没有排期|模拟数据/);
});

test("订单进入施工中后隐藏排期修订表单", () => {
  const editable = {
    ...schedule,
    tasks: schedule.tasks.map(task => ({ ...task, status: "pending" as const, responsibleProviderId: null })),
  };
  const html = render(
    { phase: "ready", data: editable, source: "live", error: null },
    schedule.demandId,
    undefined,
    { phase: "ready", order: { id: "order-1", demandId: schedule.demandId, providerId: "provider-a", acceptedQuoteId: "quote-1", status: "in_progress", source: "live" }, source: "live" },
  );
  assert.doesNotMatch(html, /修订未开工排期|确认并保存排期/);
  assert.match(html, /已进入施工中，排期修订入口已关闭/);
});
