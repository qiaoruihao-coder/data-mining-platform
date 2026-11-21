import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand } from "../src/contracts";
import { loadDemandDetail, type DemandDetailState } from "../src/features/a/demand-detail";
import { DemandDetailContent } from "../src/features/a/DemandDetailPanel";

// tsx 在仓库的 jsx:preserve 配置下使用经典 JSX；仅为本文件的渲染测试提供 React。
const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

// 仅用于测试的模拟记录，页面不包含本地演示数据。
const demand = Demand.parse({
  id: "d-1", description: "测试需求：卫生间防滑改造", city: "深圳", areaM2: 70,
  budgetMinCents: 3500000, budgetMaxCents: 5200000,
  renovationType: "elderly", desiredDays: 35, status: "published",
});
const mockDemand = { ...demand, source: "mock" as const };
const liveDemand = { ...demand, source: "live" as const };
const ok = (data: unknown, source = "live") => ({ ok: true, data, meta: { source } });
const render = (state: DemandDetailState, id = demand.id) => renderToStaticMarkup(
  createElement(DemandDetailContent, { id, state, reload() {} }),
);

test("详情只请求按 ID 接口，保留公共契约字段和 mock/live 来源", async (t) => {
  for (const source of ["mock", "live"] as const) {
    const request = t.mock.method(globalThis, "fetch", async (path: string) => {
      assert.equal(path, "/api/demand/d-1");
      return Response.json(ok(demand, source));
    });
    assert.deepEqual(await loadDemandDetail(demand.id), { phase: "ready", demand, source });
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("空编号在本地拦截；特殊字符编码后查询并严格核对 ID", async (t) => {
  const id = "需求/one?#";
  const request = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, `/api/demand/${encodeURIComponent(id)}`);
    return Response.json(ok({ ...demand, id }));
  });
  for (const invalid of ["", "  "]) assert.equal((await loadDemandDetail(invalid)).phase, "failed");
  assert.equal(request.mock.callCount(), 0);
  assert.equal((await loadDemandDetail(id)).phase, "ready");
  assert.equal(request.mock.callCount(), 1);
});

test("404 是资源不存在，不查询列表或冒充接口未开放，即使响应含成功数据", async (t) => {
  for (const response of [
    Response.json({ ok: false, error: { code: "DEMAND_NOT_FOUND", message: "需求不存在" } }, { status: 404 }),
    new Response("not found", { status: 404 }),
    Response.json(ok(demand), { status: 404 }),
  ]) {
    const request = t.mock.method(globalThis, "fetch", async () => response);
    assert.deepEqual(await loadDemandDetail(demand.id), { phase: "missing" });
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("400/401/403/501/503 明确报错，不通过列表请求掩盖失败", async (t) => {
  for (const [status, expected] of [
    [400, /编号无效/], [401, /登录/], [403, /没有权限/], [501, /尚未开放/], [503, /暂时不可用/],
  ] as const) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json(
      { ok: false, error: { code: "TEST_ERROR", message: "测试注入" } }, { status },
    ));
    const result = await loadDemandDetail(demand.id);
    assert.equal(result.phase, "failed");
    if (result.phase === "failed") {
      assert.match(result.error, expected);
      assert.match(result.error, new RegExp(`HTTP ${status}`));
    }
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("501 的非法 JSON 或成功信封也不能产生可操作详情", async (t) => {
  for (const response of [new Response("not json", { status: 501 }), Response.json(ok(demand), { status: 501 })]) {
    const request = t.mock.method(globalThis, "fetch", async () => response);
    const result = await loadDemandDetail(demand.id);
    assert.equal(result.phase, "failed");
    if (result.phase === "failed") assert.match(result.error, /尚未开放/);
    assert.equal(request.mock.callCount(), 1);
    assert.doesNotMatch(render(result), /href="\/owner\/matches\//);
    t.mock.restoreAll();
  }
});

test("错位 ID、缺少来源、非法字段和 200 错误信封被拒绝，不回退", async (t) => {
  for (const payload of [
    ok({ ...demand, id: "other" }), ok({ id: demand.id }), { ok: true, data: demand },
    ok(demand, "unknown"), { ok: false, error: { code: "ERROR", message: "失败" } },
  ]) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    const result = await loadDemandDetail(demand.id);
    assert.equal(result.phase, "failed");
    assert.equal("demand" in result, false);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("网络异常和非 JSON 不回退；用户重试可读取恢复后的详情", async (t) => {
  let attempt = 0;
  const request = t.mock.method(globalThis, "fetch", async () => {
    attempt++;
    if (attempt === 1) throw new TypeError("Network error");
    if (attempt === 2) return new Response("invalid JSON");
    return Response.json(ok(demand));
  });
  assert.equal((await loadDemandDetail(demand.id)).phase, "failed");
  assert.equal(request.mock.callCount(), 1);
  assert.equal((await loadDemandDetail(demand.id)).phase, "failed");
  assert.equal(request.mock.callCount(), 2);
  assert.equal((await loadDemandDetail(demand.id)).phase, "ready");
  assert.equal(request.mock.callCount(), 3);
});

test("加载/不存在/失败页面无匹配报价链接，也不提前断言 mock", () => {
  const states: DemandDetailState[] = [{ phase: "loading" }, { phase: "missing" }, { phase: "failed", error: "服务不可用" }];
  for (const state of states) {
    const html = render(state);
    assert.doesNotMatch(html, /href="\/owner\/(matches|quotes)\//);
    assert.doesNotMatch(html, /本条需求为模拟数据|来源 live|列表回退|尚未开放/);
  }
  assert.match(render({ phase: "loading" }), /正在加载，模拟记录会单独标注/);
  assert.match(render({ phase: "missing" }), /不存在或已被删除/);
  assert.match(render({ phase: "missing" }), /重新读取/);
  assert.match(render({ phase: "failed", error: "服务不可用" }), /role="alert"/);
});

test("详情按 demand.source 分别披露，同一个 ID 贯穿匹配报价链接", () => {
  const id = "需求/one?#";
  for (const [demandWithSource, envelopeSource] of [[mockDemand, "live"], [liveDemand, "mock"]] as const) {
    const html = render({ phase: "ready", demand: { ...demandWithSource, id }, source: envelopeSource }, id);
    assert.ok(html.includes(`/owner/matches/${encodeURIComponent(id)}`));
    assert.ok(html.includes(`/owner/quotes/${encodeURIComponent(id)}`));
    assert.match(html, /创建另一条需求/);
    assert.doesNotMatch(html, /继续补充需求|列表回退/);
    if (demandWithSource.source === "mock") assert.match(html, /模拟数据/);
    else {
      assert.match(html, /需求已保存/);
      assert.doesNotMatch(html, /模拟数据/);
    }
  }
});

test("详情缺少 demand.source 时显示未知且不猜测", () => {
  const html = render({ phase: "ready", demand, source: "mock" });
  assert.match(html, /逐条来源 未确认/);
  assert.match(html, /需求来源待确认/);
  assert.doesNotMatch(html, /模拟数据/);
});
