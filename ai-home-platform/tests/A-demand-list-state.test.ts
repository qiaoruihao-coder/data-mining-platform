import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand } from "../src/contracts";
import { loadDemandList, type DemandListState } from "../src/features/a/useDemandList";
import { DemandListContent } from "../src/features/a/DemandListPanel";

// 仓库使用 jsx:preserve；为 tsx 的经典 JSX 渲染提供测试期 React，结束后恢复。
const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

// 测试专用记录；运行页面不注入本地 mock。
const demand = Demand.parse({
  id: "saved-test", description: "测试需求", city: "深圳", areaM2: 20,
  budgetMinCents: 100000, budgetMaxCents: 200000, renovationType: "repair",
  desiredDays: 5, status: "published",
});
const mockDemand = { ...demand, id: "demo-demand", source: "mock" as const };
const liveDemand = { ...demand, source: "live" as const };
const render = (state: DemandListState) => renderToStaticMarkup(createElement(DemandListContent, { state, reload() {} }));
const ready = (items = [demand], source: "mock" | "live" = "live"): DemandListState => ({ phase: "ready", items, source, error: null });

test("列表只调用已有 GET 接口，直接解析公共 Demand，混合来源保持信封值和逐条 source", async (t) => {
  const items = [mockDemand, liveDemand];
  const request = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, "/api/demand");
    return Response.json({ ok: true, data: items, meta: { source: "mock" } });
  });
  assert.deepEqual(await loadDemandList(), ready(items, "mock"));
  assert.equal(request.mock.callCount(), 1);
});

test("公共 Demand.source 被保留并驱动逐条模拟标签", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ok: true, data: [mockDemand, liveDemand], meta: { source: "mock" },
  }));
  const result = await loadDemandList();
  assert.equal(result.items[0]?.source, "mock");
  assert.equal(result.items[1]?.source, "live");
  const html = render(result);
  assert.match(html, /模拟数据/);
  assert.equal((html.match(/模拟数据/g) ?? []).length, 2);
});

test("空列表是成功空状态，保留 mock/live 来源", async (t) => {
  for (const source of ["mock", "live"] as const) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: [], meta: { source } }));
    assert.deepEqual(await loadDemandList(), ready([], source));
    const html = render(ready([], source));
    assert.match(html, /还没有需求单/);
    assert.match(html, /0 条需求/);
    assert.match(html, /去发起需求/);
    t.mock.restoreAll();
  }
});

test("400/403/501/503 均失败且无旧数据或来源，501 伪成功也不能展示", async (t) => {
  for (const status of [400, 403, 501, 503]) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: true, data: [demand], meta: { source: "live" },
    }, { status }));
    const result = await loadDemandList();
    assert.equal(result.phase, "failed");
    assert.equal(result.source, null);
    assert.deepEqual(result.items, []);
    assert.match(result.error ?? "", new RegExp(String(status)));
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("缺少来源、非法条目、错误信封与非 JSON 不会变成空列表或成功", async (t) => {
  for (const response of [
    Response.json({ ok: true, data: [demand] }),
    Response.json({ ok: true, data: [{ id: "bad" }], meta: { source: "mock" } }),
    Response.json({ ok: false, error: { code: "ERROR", message: "失败" } }),
    new Response("invalid"),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await loadDemandList();
    assert.equal(result.phase, "failed");
    assert.equal(result.source, null);
    assert.doesNotMatch(render(result), /还没有需求单|查看需求详情/);
    t.mock.restoreAll();
  }
});

test("网络失败后用户可重试，不自动重复请求", async (t) => {
  let attempt = 0;
  const request = t.mock.method(globalThis, "fetch", async () => {
    if (++attempt === 1) throw new TypeError("Network failed");
    return Response.json({ ok: true, data: [demand], meta: { source: "live" } });
  });
  assert.equal((await loadDemandList()).phase, "failed");
  assert.equal(request.mock.callCount(), 1);
  assert.deepEqual(await loadDemandList(), ready());
  assert.equal(request.mock.callCount(), 2);
});

test("加载时提示模拟记录已单独标注，加载和失败均不提前断言来源或展示旧需求链接", () => {
  const loading = render({ phase: "loading", items: [], source: null, error: null });
  assert.match(loading, /加载中/);
  assert.match(loading, /刷新中…/);
  assert.match(loading, /正在加载，模拟记录会单独标注/);
  assert.match(loading, /列表接口来源：未确认/);
  assert.doesNotMatch(loading, /本次列表标记为 mock|真实数据库|查看需求详情/);
  const failed = render({ phase: "failed", items: [], source: null, error: "测试失败" });
  assert.match(failed, /加载失败/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /重新加载/);
  assert.doesNotMatch(failed, /加载中|模拟数据|真实数据库|查看需求详情/);
});

test("来源说明在列表前展示，全部链接保留对应 ID；live 不标成模拟", () => {
  const id = "需求/a?#";
  const items = [{ ...demand, id }];
  const html = render(ready(items, "mock"));
  assert.ok(html.indexOf("demand.source") < html.indexOf("需求编号："));
  for (const route of ["demand", "matches", "quotes"]) {
    assert.ok(html.includes(`/owner/${route}/${encodeURIComponent(id)}`));
  }
  const live = render(ready());
  assert.match(live, /真实数据库/);
  assert.match(live, /刷新列表/);
  assert.doesNotMatch(live, /模拟数据/);
});

test("列表标题和说明不再把公开需求称为我的装修", () => {
  const html = render(ready([demand]));
  assert.match(html, />需求列表</);
  assert.match(html, /未登录时展示平台公开需求；登录后展示本人全部需求/);
  assert.doesNotMatch(html, /我的装修/);
});
