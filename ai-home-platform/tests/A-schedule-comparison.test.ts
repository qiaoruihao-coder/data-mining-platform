import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Schedule, type ScheduleDTO } from "../src/contracts";
import { compareSchedules } from "../src/features/a/schedule-comparison";
import { ScheduleComparison, ScheduleComparisonPanel } from "../src/features/a/ScheduleComparisonPanel";
import { loadSchedule, SCHEDULE_LOADING, type ScheduleState } from "../src/features/a/schedule-query";

const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

// 合成排期只用于测试，不会注入页面或生产接口。
const task = (id: string, patch: Partial<ScheduleDTO["tasks"][number]> = {}): ScheduleDTO["tasks"][number] => ({
  id, name: `工序${id}`, startDay: 0, durationDays: 2, dependsOn: [], responsibleProviderId: null, status: "pending", ...patch,
});
const schedule = (version: number, tasks = [task("a")], demandId = "test-demand") => Schedule.parse({ demandId, version, tasks });
const selected = schedule(1);
const ready = (data = schedule(2), source: "live" | "mock" = "live"): ScheduleState => ({ phase: "ready", data, source, error: null });
const render = (latest: ScheduleState, source: "live" | "mock" = "live", old = selected) => renderToStaticMarkup(
  createElement(ScheduleComparisonPanel, { selected: old, source, latest, onReload() {} }),
);

test("按工序编号区分新增与移除，同名工序不被误认成同一项", () => {
  const result = compareSchedules(schedule(1, [task("old", { name: "地面" })]), schedule(2, [task("new", { name: "地面" })]));
  assert.equal(result.phase, "ready");
  if (result.phase !== "ready") return;
  assert.deepEqual(result.added.map(item => item.id), ["new"]);
  assert.deepEqual(result.removed.map(item => item.id), ["old"]);
  assert.deepEqual(result.changed, []);
});

test("同编号工序逐项展示名称、开始日、时长、依赖、责任方及状态变化", () => {
  const old = schedule(1, [task("a"), task("b", { dependsOn: ["a"] })]);
  const next = schedule(2, [task("a"), task("b", {
    name: "新的工序名", startDay: 3, durationDays: 4, dependsOn: [], responsibleProviderId: "provider-a", status: "active",
  })]);
  const result = compareSchedules(old, next);
  assert.equal(result.phase, "ready");
  if (result.phase !== "ready") return;
  assert.deepEqual(result.changed[0].fields, [
    { label: "工序名称", before: "工序b", after: "新的工序名" },
    { label: "计划开始", before: "第 1 天", after: "第 4 天" },
    { label: "计划时长", before: "2 天", after: "4 天" },
    { label: "前置工序", before: "工序a（a）", after: "无" },
    { label: "责任服务方编号", before: "未指定", after: "provider-a" },
    { label: "工序状态", before: "待开工", after: "进行中" },
  ]);
});

test("依赖和工序的排列改变不产生业务差异，比较不会修改输入", () => {
  const old = schedule(1, [task("a"), task("b"), task("c", { dependsOn: ["b", "a"] })]);
  const next = schedule(2, [task("c", { dependsOn: ["a", "b"] }), task("b"), task("a")]);
  const snapshots = JSON.stringify([old, next]);
  assert.deepEqual(compareSchedules(old, next), { phase: "ready", added: [], removed: [], changed: [] });
  assert.equal(JSON.stringify([old, next]), snapshots);
});

test("相同名称的不同依赖仍可分辨，各版本依赖名独立读取", () => {
  const old = schedule(1, [task("a", { name: "准备" }), task("b", { name: "准备" }), task("c", { dependsOn: ["a"] })]);
  const next = schedule(2, [task("a", { name: "准备" }), task("b", { name: "最新准备" }), task("c", { dependsOn: ["b"] })]);
  const result = compareSchedules(old, next);
  assert.equal(result.phase, "ready");
  if (result.phase !== "ready") return;
  assert.deepEqual(result.changed.find(item => item.task.id === "c")?.fields, [
    { label: "前置工序", before: "准备（a）", after: "最新准备（b）" },
  ]);
});

test("责任方取消、受阻与完成状态显示中文，不推断姓名或实际日期", () => {
  const old = schedule(1, [task("a", { responsibleProviderId: "provider-a", status: "blocked" })]);
  const next = schedule(2, [task("a", { status: "done" })]);
  const html = render(ready(next), "live", old);
  assert.match(html, /provider-a/);
  assert.match(html, /未指定/);
  assert.match(html, /受阻待处理/);
  assert.match(html, /已完成/);
  assert.doesNotMatch(html, /blocked|pending|active|确认完工|确认开工|应用此版本/);
});

test("需求错位、最新版本倒退、任一版本重复编号时拒绝对比", () => {
  for (const [old, next] of [
    [selected, schedule(2, [task("a")], "other-demand")],
    [schedule(3), schedule(2)],
    [schedule(1, [task("a"), task("a")]), schedule(2)],
    [selected, schedule(2, [task("a"), task("a")])],
  ]) assert.equal(compareSchedules(old, next).phase, "invalid");
});

test("同版本必须内容一致，不同版本可以没有工序变化，空排期正常比较", () => {
  assert.equal(compareSchedules(selected, schedule(1, [task("a", { startDay: 1 })])).phase, "invalid");
  assert.match(render(ready(schedule(1))), /已是本次读取的最新版本/);
  assert.match(render(ready(schedule(2))), /两版工序内容一致/);
  assert.deepEqual(compareSchedules(schedule(1, []), schedule(2, [])), { phase: "ready", added: [], removed: [], changed: [] });
  assert.match(render(ready(schedule(2, []))), /移除 1 项/);
  assert.match(render(ready(schedule(2)), "live", schedule(1, [])), /新增 1 项/);
});

test("各版本分别标记来源，新增、移除、修改的数量与旧新值清楚呈现", () => {
  const old = schedule(1, [task("a"), task("removed")]);
  const next = schedule(3, [task("a", { durationDays: 5 }), task("added")]);
  const html = render(ready(next), "mock", old);
  assert.match(html, /所选版本 v1/);
  assert.match(html, /模拟数据/);
  assert.match(html, /最新版本 v3/);
  assert.match(html, /实际排期/);
  assert.match(html, /新增 1 项 · 移除 1 项 · 修改 1 项/);
  assert.match(html, /所选版本：2 天/);
  assert.match(html, /最新版本：5 天/);
  assert.match(html, /刷新对比/);
  assert.doesNotMatch(html, /没有新增|保存排期|确认修订/);
});

test("加载、缺失、失败均不显示差异结论或旧内容，加载说明包含模拟二字", () => {
  const loading = render(SCHEDULE_LOADING);
  assert.match(loading, /模拟记录/);
  assert.match(loading, / disabled=""/);
  for (const phase of ["missing", "failed"] as const) {
    const html = render({ phase, data: null, source: null, error: "internal detail" });
    assert.match(html, /刷新对比/);
    assert.doesNotMatch(html, /没有新增|两版工序内容一致|internal detail|工序a| disabled=""/);
  }
  assert.doesNotMatch(loading, /两版工序内容一致|修改工序/);
  const html = render(ready(schedule(1, [task("a", { name: "不一致" })])));
  assert.match(html, /同一版本的两次读取内容不一致/);
  assert.doesNotMatch(html, /修改工序|两版工序内容一致/);
});

test("对比组件初次呈现仅加载最新版本，不把所选版本充作最新", () => {
  const html = renderToStaticMarkup(createElement(ScheduleComparison, { selected, source: "live" }));
  assert.match(html, /正在读取最新排期/);
  assert.doesNotMatch(html, /已是本次读取的最新版本|两版工序内容一致/);
});

test("最新排期读取为 GET，401/501/503 不变成无差异；重试可取得新版本", async (t) => {
  let status = 401;
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/schedule?demandId=test-demand");
    assert.equal(init, undefined);
    return Response.json({ ok: true, data: schedule(3, [task("a", { durationDays: 5 })]), meta: { source: "mock" } }, { status });
  });
  for (status of [401, 501, 503]) {
    const state = await loadSchedule(selected.demandId);
    assert.equal(state.phase, "failed");
    assert.doesNotMatch(render(state), /两版工序内容一致|修改工序/);
  }
  status = 200;
  const state = await loadSchedule(selected.demandId);
  assert.equal(state.phase, "ready");
  const html = render(state);
  assert.match(html, /最新版本 v3/);
  assert.match(html, /模拟数据/);
  assert.match(html, /最新版本：5 天/);
});
