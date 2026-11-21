import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO, type SourceDTO } from "../src/contracts";
import { DemandHallContent } from "../src/features/c/DemandHall";
import { DemandDetailContent } from "../src/features/c/DemandDetail";
import { AdminDemandOverviewContent } from "../src/features/c/AdminDemandOverview";
import { loadDemandHall } from "../src/features/c/demand-hall";
import { loadDemandDetail } from "../src/features/c/demand-detail";
import { loadAdminDemands, summarizeAdminDemands } from "../src/features/c/admin-demand-overview";

// 仅测试使用的合成记录；特意用易误判的编号检查页面不会从 ID 推断来源。
const base = Demand.parse({
  id: "C-source-test", description: "来源展示测试", city: "测试城市", areaM2: 10,
  budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair",
  desiredDays: 1, status: "published",
});
const records: DemandDTO[] = [
  { ...base, id: "ordinary-id", source: "mock" },
  { ...base, id: "demo-looking-id", source: "live" },
  { ...base, id: "demo-demand" },
];
const expectedLabels = ["模拟需求", "已保存需求", "需求来源待确认"];
function response(data: DemandDTO[], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function hall(data: DemandDTO[], source: SourceDTO = "mock") {
  return renderToStaticMarkup(createElement(DemandHallContent, { state: { status: "ready", response: response(data, source) }, onReload() {} }));
}
function admin(data: DemandDTO[], source: SourceDTO = "mock") {
  return renderToStaticMarkup(createElement(AdminDemandOverviewContent, { state: { status: "ready", response: response(data, source) }, onReload() {} }));
}

test("大厅和管理概览的每条标识对应本条 source，不能由整批来源或编号替代", () => {
  for (const source of ["mock", "live"] as const) {
    const cards = hall(records, source).match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
    const rows = admin(records, source).match(/<tr>\s*<th scope="row"[\s\S]*?<\/tr>/g) ?? [];
    for (const fragments of [cards, rows]) {
      assert.equal(fragments.length, 3);
      fragments.forEach((fragment, index) => {
        assert.ok(fragment.includes(records[index].id));
        assert.ok(fragment.includes(expectedLabels[index]));
        assert.equal((fragment.match(/模拟需求|已保存需求|需求来源待确认/g) ?? []).length, 1);
        expectedLabels.filter((_, labelIndex) => index !== labelIndex).forEach((label) => assert.ok(!fragment.includes(label)));
      });
    }
    assert.doesNotMatch(hall(records, source), /以下为接口返回的固定演示数据/);
  }
});

test("详情区分接口来源和需求来源，缺失逐条来源时在两种响应下都保持未知", () => {
  for (const source of ["mock", "live"] as const) {
    records.forEach((record, index) => {
      const html = renderToStaticMarkup(createElement(DemandDetailContent, {
        demandId: record.id,
        state: { status: "ready", response: { ...response([], source), data: record } }, onReload() {},
      }));
      const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/)?.[0];
      assert.ok(article);
      assert.ok(article.includes(expectedLabels[index]));
      assert.equal((article.match(/模拟需求|已保存需求|需求来源待确认/g) ?? []).length, 1);
      assert.ok(html.includes(source === "mock" ? "含模拟数据" : "已保存记录"));
      assert.doesNotMatch(html, /当前需求为模拟数据|当前需求来自实时接口/);
    });
  }
});

test("三个加载器保留公共契约的逐条来源，缺失字段保持缺失", async (t) => {
  t.mock.method(globalThis, "fetch", async (path: string) => Response.json(
    path === "/api/demand" ? response(records) : { ...response([]), data: records.find((record) => path.endsWith(`/${record.id}`)) },
  ));
  for (const loaded of [await loadDemandHall(), await loadAdminDemands()]) assert.deepEqual(loaded.data, records);
  for (const record of records) assert.deepEqual((await loadDemandDetail(record.id)).data, record);
});

test("过滤掉模拟需求后保留接口标识，但不能声称剩余 live 需求也是模拟", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(response([
    { ...records[0], status: "draft" }, records[1],
  ])));
  const loaded = await loadDemandHall();
  const html = hall(loaded.data, loaded.meta.source);
  assert.equal(loaded.meta.source, "mock");
  assert.deepEqual(loaded.data, [records[1]]);
  assert.match(html, /含模拟数据/);
  assert.match(html, /已保存需求/);
  assert.doesNotMatch(html, /需求来源：模拟数据|以下为接口返回的固定演示数据/);
});

test("状态统计仍包含各来源记录，明确统计范围而不称作真实需求总数", () => {
  assert.deepEqual(summarizeAdminDemands(records), {
    total: 3, byStatus: { draft: 0, published: 3, contracted: 0, in_progress: 0, completed: 0 },
  });
  assert.match(admin(records), /统计包含本次返回的所有需求，包括模拟、实际创建及来源未知的记录/);
});

test("空列表、不可报价详情与加载或失败状态不产生逐条来源标识", () => {
  const outputs = [hall([]), admin([])];
  for (const state of [{ status: "loading" }, { status: "error", message: "请求失败" }] as const) {
    outputs.push(renderToStaticMarkup(createElement(DemandHallContent, { state, onReload() {} })));
    outputs.push(renderToStaticMarkup(createElement(AdminDemandOverviewContent, { state, onReload() {} })));
    outputs.push(renderToStaticMarkup(createElement(DemandDetailContent, { demandId: base.id, state, onReload() {} })));
  }
  outputs.push(renderToStaticMarkup(createElement(DemandDetailContent, {
    demandId: base.id, state: { status: "ready", response: { ...response([]), data: null } }, onReload() {},
  })));
  for (const html of outputs) assert.doesNotMatch(html, /需求来源：/);
});

test("非法逐条来源拒绝整个响应，不降级为未知或从 meta 推测", async (t) => {
  for (const source of [null, "unknown", "<script>"]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async (path: string) => Response.json({
      ok: true, data: path === "/api/demand" ? [{ ...base, source }] : { ...base, source }, meta: { source: "live" },
    }));
    await assert.rejects(loadDemandHall());
    await assert.rejects(loadAdminDemands());
    await assert.rejects(loadDemandDetail(base.id));
    fetchMock.mock.restore();
  }
});
