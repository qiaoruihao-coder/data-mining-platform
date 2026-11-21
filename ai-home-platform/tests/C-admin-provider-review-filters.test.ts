import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider, type ProviderDTO, type SourceDTO } from "../src/contracts";
import { AdminProviderReviewsContent } from "../src/features/c/AdminProviderReviews";
import {
  adminProviderReviewsFailure, defaultAdminProviderReviewFilters, filterAdminProviderReviews, loadAdminProviderReviews,
  type AdminProviderReviewFilters, type AdminProviderReviewsState,
} from "../src/features/c/admin-provider-reviews";

// 合成测试夹具，不作为运行页面的数据或接口失败后的兜底。
const performance = { basis: "completed_order_review_average", averageRating: 4.25, reviewCount: 3,
  calculatedAt: "2026-11-14T10:00:00.000Z", source: "live" };
const base = { name: "合成施工团队", city: "深圳", kind: "construction", tags: ["不应匹配的标签"], rating: 4.99, source: "mock" };
const records = Provider.array().parse([
  { ...base, id: "C-review-Z", performance },
  { ...base, id: "C-review-A", name: "合成 Design 团队", performance: { ...performance, averageRating: null, reviewCount: 0 } },
  { ...base, id: "C-review-null", city: "广州", performance: null },
  { ...base, id: "literal/?#%", city: "广州", name: "合成 .* <script>" },
]);
function payload(data: ProviderDTO[] = records) {
  return { ok: true as const, data, meta: { source: "mock" as const } };
}
function render(state: AdminProviderReviewsState, filters = defaultAdminProviderReviewFilters, source: SourceDTO = "live") {
  return renderToStaticMarkup(createElement(AdminProviderReviewsContent, {
    source, state, filters, onSourceChange() {}, onReload() {}, onFiltersChange() {},
  }));
}
function selected(keyword: string, sampleState: AdminProviderReviewFilters["sampleState"] = "all") {
  return filterAdminProviderReviews(records, { keyword, sampleState }).map(record => record.id);
}

test("样本筛选区分已有、零样本、缺省/null 未知，不使用旧 rating，保留接口顺序和原记录", () => {
  const before = structuredClone(records);
  assert.deepEqual(filterAdminProviderReviews(records, defaultAdminProviderReviewFilters), records);
  assert.deepEqual(selected("", "with_reviews"), [records[0].id]);
  assert.deepEqual(selected("", "no_reviews"), [records[1].id]);
  assert.deepEqual(selected("", "unknown"), [records[2].id, records[3].id]);
  for (const record of filterAdminProviderReviews(records, { keyword: "广州", sampleState: "unknown" })) {
    assert.ok(records.includes(record));
  }
  assert.deepEqual(records, before);
});

test("关键词匹配名称、编号、城市，忽略首尾空白和大小写，字面连续匹配并与样本条件取交集", () => {
  assert.deepEqual(selected(" c-REVIEW-a "), [records[1].id]);
  assert.deepEqual(selected("\t DESIGN \n"), [records[1].id]);
  assert.deepEqual(selected("深圳"), [records[0].id, records[1].id]);
  assert.deepEqual(selected("广州", "unknown"), [records[2].id, records[3].id]);
  assert.deepEqual(selected("深圳", "no_reviews"), [records[1].id]);
  assert.deepEqual(selected("广州", "with_reviews"), []);
  assert.deepEqual(selected(".*"), [records[3].id]);
  assert.deepEqual(selected("/?#%"), [records[3].id]);
  assert.deepEqual(selected("<script>"), [records[3].id]);
  assert.deepEqual(selected(" \t\n "), records.map(record => record.id));
  for (const keyword of ["C-review-Z合成", "不应匹配的标签", "4.99", "mock", "Design  团队"]) assert.deepEqual(selected(keyword), []);
});

test("筛选后显示匹配数和目录总数，保留独立来源、均分与样本说明，不将零样本作零分", () => {
  const html = render({ status: "ready", response: payload() }, { keyword: "深圳", sampleState: "no_reviews" });
  for (const text of ["本次目录 4 家服务方", "当前显示 1 / 4 家服务方", "清除筛选", "合成 Design 团队",
    "目录响应来源：模拟记录（mock）", "基础资料来源：模拟记录（mock）", "评价来源：实际记录（live）",
    "暂无均分", "0 条", "刷新汇总或切换评价来源会保留筛选条件", 'value="no_reviews" selected=""', 'value="深圳"']) {
    assert.ok(html.includes(text), text);
  }
  assert.equal((html.match(/<li\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /C-review-Z|C-review-null|literal\/|4\.99|>0\.00</);
  const unknown = render({ status: "ready", response: payload() }, { keyword: ".*", sampleState: "unknown" });
  assert.match(unknown, /合成 \.\* &lt;script&gt;/);
  assert.match(unknown, /未提供评价汇总，暂不能判断是否有样本/);
  assert.doesNotMatch(unknown, /<script|暂无均分|评价来源：/);
});

test("真实空目录与筛选无匹配分开，清除不改变评价口径，空白关键词也可清除", () => {
  const filters: AdminProviderReviewFilters = { keyword: "没有匹配", sampleState: "unknown" };
  const noMatch = render({ status: "ready", response: payload() }, filters);
  assert.match(noMatch, /没有符合筛选条件的服务方/);
  assert.match(noMatch, /当前显示 0 \/ 4 家服务方/);
  assert.doesNotMatch(noMatch, /本次目录暂无服务方|<li\b/);
  const empty = render({ status: "ready", response: payload([]) }, filters);
  assert.match(empty, /本次目录暂无服务方/);
  assert.match(empty, /当前显示 0 \/ 0 家服务方/);
  assert.doesNotMatch(empty, /没有符合筛选条件的服务方/);
  const cleared = render({ status: "ready", response: payload() }, defaultAdminProviderReviewFilters);
  assert.match(cleared, /当前显示 4 \/ 4 家服务方/);
  assert.match(cleared, /value="live" selected=""/);
  assert.doesNotMatch(cleared, /清除筛选/);
  assert.match(render({ status: "ready", response: payload() }, { keyword: "  ", sampleState: "all" }), /清除筛选/);
});

test("保留条件重新筛选不同来源的新响应，筛选不改查询协议或用另一来源补样本", async t => {
  const filters: AdminProviderReviewFilters = { keyword: "深圳", sampleState: "with_reviews" };
  const mockRecords = records.map(record => ({ ...record, performance: { ...records[0].performance!, source: "mock" as const } }));
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(init, undefined);
    assert.ok(path === "/api/provider?performanceSource=live" || path === "/api/provider?performanceSource=mock");
    return Response.json(payload(path.endsWith("=mock") ? mockRecords : records));
  });
  const live = render({ status: "ready", response: await loadAdminProviderReviews("live") }, filters);
  const mock = render({ status: "ready", response: await loadAdminProviderReviews("mock") }, filters, "mock");
  assert.match(live, /当前显示 1 \/ 4 家服务方/);
  assert.match(mock, /当前显示 2 \/ 4 家服务方/);
  assert.match(mock, /评价来源：模拟记录（mock）/);
  assert.doesNotMatch(mock, /评价来源：实际记录（live）/);
  assert.equal(fetched.mock.callCount(), 2);
});

test("筛选前验证整批响应，加载、501/503 和坏记录不伪装成无匹配或残留旧结果", async t => {
  const filters: AdminProviderReviewFilters = { keyword: "不匹配任何记录", sampleState: "no_reviews" };
  const responses = [Response.json(payload(), { status: 501 }), Response.json(payload(), { status: 503 }),
    Response.json(payload([...records, { ...records[0], id: "bad", performance: { ...records[0].performance!, source: "mock" } }]))];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  for (const expected of [/尚未实现/, /暂时不可用/, /格式、编号或来源异常/]) {
    await assert.rejects(loadAdminProviderReviews("live"), error => {
      const html = render(adminProviderReviewsFailure(error), filters);
      assert.match(html, expected);
      assert.doesNotMatch(html, /当前显示|没有符合筛选|本次目录暂无|目录响应来源：|C-review-Z|<dd/);
      return true;
    });
  }
  assert.doesNotMatch(render({ status: "loading" }, filters), /当前显示|没有符合筛选|本次目录暂无|<dd/);
});
