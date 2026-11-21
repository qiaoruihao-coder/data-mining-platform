import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO } from "../src/contracts";
import { filterDemands } from "../src/features/a/demand-list";
import { DemandListContent } from "../src/features/a/DemandListPanel";

// 合成测试记录，页面运行时仍只读取公共 API。
const base = Demand.parse({
  id: "Owner-A/1?#", description: "卫生间防滑改造", city: "深圳", areaM2: 60,
  budgetMinCents: 3000000, budgetMaxCents: 5000000, renovationType: "elderly",
  desiredDays: 30, status: "published", source: "live",
});
const items: DemandDTO[] = [
  base,
  { ...base, id: "demo-demand", city: "广州", status: "in_progress", source: "mock" },
  { ...base, id: "unknown-source", description: "厨房维修", status: "completed", source: undefined },
];

const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

test("关键词匹配编号、城市或描述，忽略首尾空白和英文大小写，特殊字符按原文匹配", () => {
  assert.deepEqual(filterDemands(items, "  OWNER-a/1?#  ", "all"), [items[0]]);
  assert.deepEqual(filterDemands(items, "深圳", "all"), [items[0], items[2]]);
  assert.deepEqual(filterDemands(items, "防滑", "all"), [items[0], items[1]]);
  assert.deepEqual(filterDemands(items, ".*", "all"), []);
  assert.deepEqual(filterDemands(items, "深圳卫生间", "all"), []);
});

test("状态与关键词同时生效，覆盖公共契约的全部状态", () => {
  for (const status of Demand.shape.status.options) {
    const record = { ...base, status };
    assert.deepEqual(filterDemands([record], "防滑", status), [record]);
  }
  assert.deepEqual(filterDemands(items, "防滑", "in_progress"), [items[1]]);
  assert.deepEqual(filterDemands(items, "深圳", "in_progress"), []);
  assert.deepEqual(filterDemands(items, "", "completed"), [items[2]]);
});

test("空关键词与全部状态恢复原顺序，筛选不更改记录、来源或原列表", () => {
  const snapshot = structuredClone(items);
  for (const keyword of ["", "  \t\n"]) {
    assert.deepEqual(filterDemands(items, keyword, "all"), items);
  }
  const matches = filterDemands(items, "防滑", "all");
  assert.equal(matches[0], items[0]);
  assert.equal(matches[1], items[1]);
  assert.deepEqual(matches.map((item) => item.source), ["live", "mock"]);
  assert.equal(filterDemands(items, "厨房", "all")[0].source, undefined);
  assert.deepEqual(items, snapshot);
  assert.deepEqual(filterDemands([], "防滑", "all"), []);
});

test("列表筛选控件具有标签，默认展示全部记录并保留混合来源和编码后的链接", () => {
  const html = renderToStaticMarkup(createElement(DemandListContent, {
    state: { phase: "ready", items, source: "mock", error: null }, reload() {},
  }));
  assert.match(html, /搜索需求/);
  assert.match(html, /需求状态/);
  assert.match(html, /type="search"/);
  assert.match(html, /显示 3 \/ 3 条需求/);
  assert.match(html, /仅筛选当前已加载的数据/);
  assert.match(html, /模拟数据/);
  assert.equal((html.match(/模拟数据/g) ?? []).length, 2);
  assert.match(html, /需求编号：unknown-source/);
  assert.ok(html.includes(`/owner/demand/${encodeURIComponent(base.id)}`));
  assert.equal((html.match(/查看需求详情/g) ?? []).length, 3);
  assert.doesNotMatch(html, /没有符合筛选条件的需求/);
});
