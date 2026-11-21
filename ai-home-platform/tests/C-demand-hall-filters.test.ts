import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO, type SourceDTO } from "../src/contracts";
import { DemandHallContent } from "../src/features/c/DemandHall";
import {
  defaultDemandHallFilters, demandHallFailureState, demandHallRenovationOptions, filterHallDemands,
  loadDemandHall, type DemandHallFilters, type DemandHallState,
} from "../src/features/c/demand-hall";

// 合成测试数据，不被页面引用，不作为读取失败时的兜底。
const base = Demand.parse({ id: "C-hall-A", city: "深圳", description: "合成浴室防滑需求",
  areaM2: 20, budgetMinCents: 0, budgetMaxCents: 123456, desiredDays: 15,
  renovationType: "elderly", status: "published" });
const records = Demand.array().parse([
  { ...base, source: "mock" },
  { ...base, id: "C-hall-B", renovationType: "partial", description: "合成厨房 Layout", source: "live" },
  { ...base, id: "需求/A?b#c%", renovationType: "repair", city: "广州", description: "合成浴室维修" },
  { ...base, id: "literal", renovationType: "repair", city: "深圳", description: "合成字面 .* 与 <script>", source: "mock" },
]);
function payload(data: DemandDTO[] = records, source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: DemandHallState, filters: DemandHallFilters = defaultDemandHallFilters) {
  return renderToStaticMarkup(createElement(DemandHallContent, { state, filters, onReload() {}, onFiltersChange() {} }));
}
function selected(keyword: string, renovationType: DemandHallFilters["renovationType"] = "all") {
  return filterHallDemands(records, { keyword, renovationType }).map(record => record.id);
}

test("大厅改造类型来自公共枚举，默认全量且组合筛选保留原顺序和记录", () => {
  const before = structuredClone(records);
  assert.deepEqual(demandHallRenovationOptions, ["all", ...Demand.shape.renovationType.options]);
  assert.deepEqual(filterHallDemands(records, defaultDemandHallFilters), records);
  for (const renovationType of Demand.shape.renovationType.options) {
    const filtered = filterHallDemands(records, { keyword: "", renovationType });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every(record => record.renovationType === renovationType));
    assert.ok(filtered.every(record => records.includes(record)));
  }
  assert.deepEqual(selected("浴室", "repair"), [records[2].id]);
  assert.deepEqual(selected("深圳", "repair"), [records[3].id]);
  assert.deepEqual(selected("广州", "partial"), []);
  assert.deepEqual(records, before);
});

test("关键词分别匹配编号、城市、描述，忽略首尾空白和大小写，按字面连续文本匹配", () => {
  assert.deepEqual(selected("  c-HALL-b  "), [records[1].id]);
  assert.deepEqual(selected("\t LAYOUT \n"), [records[1].id]);
  assert.deepEqual(selected("深圳"), [records[0].id, records[1].id, records[3].id]);
  assert.deepEqual(selected("?B#C%"), [records[2].id]);
  assert.deepEqual(selected(".*"), [records[3].id]);
  assert.deepEqual(selected("<script>"), [records[3].id]);
  assert.deepEqual(selected(" \t\n "), records.map(record => record.id));
  for (const keyword of ["C-hall-A深圳", "浴室 维修", "123456", "mock", "适老化改造"]) assert.deepEqual(selected(keyword), []);
});

test("任何筛选不恢复非已发布需求，接口仍无参数读取且先校验完整响应", async t => {
  const unpublished = Demand.shape.status.options.filter(status => status !== "published").map(status => ({ ...base, id: status, status }));
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/demand");
    assert.equal(init, undefined);
    return Response.json(payload([...records, ...unpublished]));
  });
  const response = await loadDemandHall();
  assert.deepEqual(response.data, records);
  assert.deepEqual(filterHallDemands([...records, ...unpublished], defaultDemandHallFilters), records);
  for (const keyword of ["draft", "completed", "深圳"]) filterHallDemands(response.data, { keyword, renovationType: "all" });
  assert.equal(fetched.mock.callCount(), 1);
});

test("筛选结果数量与完整范围分开，保留来源、金额、工期及精确编码链接", () => {
  for (const source of ["mock", "live"] as const) {
    const html = render({ status: "ready", response: payload(records, source) }, { keyword: "浴室", renovationType: "repair" });
    for (const text of ["本次读取的已发布需求共 4 条", "当前显示 1 / 4 条已发布需求", "清除筛选", "需求来源待确认",
      "按关键词或改造类型查找需求", "按关键词或改造类型查找需求", "按关键词或改造类型查找需求", "0.00", "1,234.56", "15 天"]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(source === "mock" ? "含模拟数据" : "已保存记录"));
    assert.match(html, /<option value="repair" selected="">维修/);
    assert.ok(html.includes(`href="/provider/demand/${encodeURIComponent(records[2].id)}"`));
    assert.equal((html.match(/<article\b/g) ?? []).length, 1);
    assert.doesNotMatch(html, /合成厨房|合成浴室防滑|合成字面|需求来源：模拟数据|需求来源：实际创建/);
  }
  const live = render({ status: "ready", response: payload() }, { keyword: "Layout", renovationType: "all" });
  assert.match(live, /含模拟数据/);
  assert.match(live, /已保存需求/);
  assert.doesNotMatch(live, /需求来源：模拟数据/);
});

test("合法空列表与筛选无结果区分，空白输入可清除，默认不出现清除按钮", () => {
  const filters: DemandHallFilters = { keyword: "不存在", renovationType: "repair" };
  const noMatch = render({ status: "ready", response: payload() }, filters);
  assert.match(noMatch, /没有符合筛选条件的需求/);
  assert.match(noMatch, /当前显示 0 \/ 4 条已发布需求/);
  assert.doesNotMatch(noMatch, /暂无已发布需求|<article/);
  for (const source of ["mock", "live"] as const) {
    const empty = render({ status: "ready", response: payload([], source) }, filters);
    assert.match(empty, /暂无已发布需求/);
    assert.match(empty, /当前显示 0 \/ 0 条已发布需求/);
    assert.doesNotMatch(empty, /没有符合筛选条件的需求|<article|需求来源：/);
  }
  assert.match(render({ status: "ready", response: payload() }, { keyword: "   ", renovationType: "all" }), /清除筛选/);
  assert.doesNotMatch(render({ status: "ready", response: payload() }), /清除筛选/);
});

test("文本转义且输入有标签和提示，不把筛选解释为智能匹配或提交报价", () => {
  const html = render({ status: "ready", response: payload() }, { keyword: "<script>", renovationType: "repair" });
  for (const text of ['for="demand-hall-keyword"', 'type="search"', 'aria-describedby="demand-hall-keyword-hint"',
    'for="demand-hall-renovation"', 'aria-live="polite"', "&lt;script&gt;", "搜索城市、需求描述或编号"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script|智能匹配|匹配得分|报价成功|<form/);
});

test("加载、权限或查询失败隐藏筛选、结果和旧来源，501 成功形状仍是失败", async t => {
  const filters: DemandHallFilters = { keyword: "深圳", renovationType: "elderly" };
  const absent = /id="demand-hall-keyword"|id="demand-hall-renovation"|当前显示|<article|列表接口来源：|暂无已发布需求|没有符合筛选条件/;
  assert.doesNotMatch(render({ status: "loading" }, filters), absent);
  for (const status of [401, 403, 501, 503]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload(), { status }));
    await assert.rejects(loadDemandHall(), error => {
      const html = render(demandHallFailureState(error), filters);
      assert.match(html, /role="alert"/);
      if (status === 501) assert.match(html, /尚未实现/);
      assert.doesNotMatch(html, absent);
      return true;
    });
    fetched.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(loadDemandHall(), error => {
    assert.doesNotMatch(render(demandHallFailureState(error), filters), absent);
    return true;
  });
});

test("被筛除的记录含坏字段也拒绝整批响应，不伪装无匹配", async t => {
  for (const invalid of [
    { ...base, id: "invalid", renovationType: "unknown" }, { ...base, id: "invalid", city: null },
    { ...base, id: "invalid", status: "draft", source: "unknown" }, { ...base, id: "invalid", budgetMinCents: -1 },
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: [...records, invalid], meta: { source: "live" } }));
    await assert.rejects(loadDemandHall(), error => {
      const html = render(demandHallFailureState(error), { keyword: records[1].id, renovationType: "partial" });
      assert.match(html, /需求列表加载失败/);
      assert.doesNotMatch(html, /<article|当前显示|没有符合筛选条件|列表接口来源：/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("刷新后同一条件按最新列表重算，失败不留旧结果，清除可恢复当前全部记录", async t => {
  const filters: DemandHallFilters = { keyword: "深圳", renovationType: "elderly" };
  const responses = [Response.json(payload()), Response.json({ ok: false }, { status: 503 }),
    Response.json(payload([{ ...base, city: "广州", source: "live" }, records[1]], "live")), Response.json(payload([], "live"))];
  const fetched = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.match(render({ status: "ready", response: await loadDemandHall() }, filters), /当前显示 1 \/ 4/);
  await assert.rejects(loadDemandHall(), error => {
    assert.doesNotMatch(render(demandHallFailureState(error), filters), /<article|当前显示/);
    return true;
  });
  const response = await loadDemandHall();
  const filtered = render({ status: "ready", response }, filters);
  assert.match(filtered, /没有符合筛选条件的需求/);
  assert.match(filtered, /当前显示 0 \/ 2/);
  assert.match(filtered, /value="深圳"/);
  assert.match(filtered, /<option value="elderly" selected="">/);
  assert.match(filtered, /已保存记录/);
  const cleared = render({ status: "ready", response });
  assert.match(cleared, /当前显示 2 \/ 2/);
  assert.equal((cleared.match(/<article\b/g) ?? []).length, 2);
  assert.match(render({ status: "ready", response: await loadDemandHall() }, filters), /暂无已发布需求/);
  assert.equal(fetched.mock.callCount(), 4);
});
