import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, type DemandDTO } from "../src/contracts";
import { DemandHallContent } from "../src/features/c/DemandHall";
import {
  demandHallErrorMessage,
  formatBudget,
  loadDemandHall,
  type DemandHallState,
} from "../src/features/c/demand-hall";

// 仅用于测试的模拟需求；页面数据始终来自公共接口。
const demand = Demand.parse({
  id: "C-test-demand",
  description: "测试模拟需求：浴室防滑改造。",
  city: "深圳",
  areaM2: 60,
  budgetMinCents: 3000000,
  budgetMaxCents: 5000050,
  renovationType: "elderly",
  desiredDays: 30,
  status: "published",
});

function render(state: DemandHallState) {
  return renderToStaticMarkup(createElement(DemandHallContent, { state, onReload() {} }));
}

test("需求大厅使用公共 GET 接口并只展示已发布需求，保留来源", async (t) => {
  const statuses: DemandDTO["status"][] = ["draft", "published", "contracted", "in_progress", "completed"];
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, "/api/demand");
    return Response.json({
      ok: true,
      data: statuses.map((status) => ({ ...demand, id: status, status })),
      meta: { source: "mock" },
    });
  });
  const response = await loadDemandHall();
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(response.data.map((item) => item.id), ["published"]);
  assert.equal(response.meta.source, "mock");
});

test("需求大厅接受空数组和 live 来源，不添加模拟兜底数据", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: [], meta: { source: "live" } }));
  const response = await loadDemandHall();
  assert.deepEqual(response.data, []);
  const html = render({ status: "ready", response });
  assert.match(html, /暂无已发布需求/);
  assert.match(html, /已保存记录/);
  assert.doesNotMatch(html, /需求来源：|<article/);
});

test("需求大厅渲染预算、工期和 mock 来源，不冒充真实需求或已接单", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: [demand], meta: { source: "mock" } }));
  const html = render({ status: "ready", response: await loadDemandHall() });
  for (const text of ["含模拟数据", "需求来源待确认", "固定演示需求仅供查看", "深圳", "60 平方米", "30,000.00", "50,000.50", "30 天", "适老化改造", "登录服务方后可查看需求并报价", "登录服务方后可查看需求并报价", "账号尚未完成资质认证", "同时登录业主和服务方时", "只显示该业主的需求", "退出业主登录", "登录并刷新", "两个浏览器"]) {
    assert.ok(html.includes(text), text);
  }
  assert.doesNotMatch(html, /已接单|报价成功|报价提交和接单功能待接入/);
  assert.match(formatBudget(0), /0\.00/);
  assert.match(formatBudget(101), /1\.01/);
});

test("需求大厅将只有未发布需求的响应展示为空列表", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: [{ ...demand, status: "draft" }], meta: { source: "mock" } }));
  const html = render({ status: "ready", response: await loadDemandHall() });
  assert.match(html, /暂无已发布需求/);
  assert.doesNotMatch(html, /测试模拟需求/);
});

test("需求大厅拒绝缺失来源、无效数据和 HTTP 200 的业务失败", async (t) => {
  const payloads = [
    { ok: true, data: [demand] },
    { ok: true, data: [demand], meta: { source: "unknown" } },
    { ok: true, data: [{ ...demand, budgetMaxCents: -1 }], meta: { source: "mock" } },
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "未实现" } },
  ];
  for (const payload of payloads) {
    const mocked = t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    await assert.rejects(loadDemandHall());
    mocked.mock.restore();
  }
});

test("需求大厅将 HTTP 501 作为未实现错误，显示可重试状态", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "未实现" } }, { status: 501 }));
  await assert.rejects(loadDemandHall(), (error: unknown) => {
    const message = demandHallErrorMessage(error);
    assert.match(message, /尚未实现/);
    const html = render({ status: "error", message });
    assert.match(html, /role="alert"/);
    assert.match(html, /重新加载/);
    assert.doesNotMatch(html, /<article|来源：|暂无已发布需求/);
    return true;
  });
});

test("需求大厅不把 HTTP 500、网络异常或非 JSON 响应当成空列表", async (t) => {
  const failures = [
    async () => Response.json({ ok: true, data: [demand], meta: { source: "mock" } }, { status: 500 }),
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("not json", { status: 200 }),
  ];
  for (const failure of failures) {
    const mocked = t.mock.method(globalThis, "fetch", failure);
    await assert.rejects(loadDemandHall(), (error: unknown) => {
      assert.match(render({ status: "error", message: demandHallErrorMessage(error) }), /需求列表加载失败/);
      return true;
    });
    mocked.mock.restore();
  }
});

test("需求大厅加载中禁用刷新并提供可读提示", () => {
  const html = render({ status: "loading" });
  assert.match(html, /disabled=""/);
  assert.match(html, /role="status"/);
  assert.match(html, /正在读取需求/);
  assert.match(html, /固定演示需求仅供查看/);
  assert.doesNotMatch(html, /<article|来源：|暂无已发布需求/);
});
