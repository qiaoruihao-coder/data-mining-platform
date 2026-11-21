import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DemandDTO, SourceDTO } from "../src/contracts";
import { demoDemand, providers } from "../src/lib/mock-data";
import { ApiClientError } from "../src/lib/api-client";
import { loadMatches, MatchDemandNotFound } from "../src/features/b/load-matches";
import { MatchPageContent } from "../src/features/b/MatchPage";

const success = (data: unknown, source: SourceDTO = "live") => Response.json({ ok: true, data, meta: { source } });
const render = (data: Awaited<ReturnType<typeof loadMatches>>) => renderToStaticMarkup(createElement(MatchPageContent, {
  state: { status: "ready", data }, retry: () => undefined,
}));

test("模拟资料空匹配不推断现实团队数量，来源由服务方信封决定", async (t) => {
  for (const demandSource of ["mock", "live", undefined] as const) {
    t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider"
      ? success(providers, "mock") : success({ ...demoDemand, city: "无样例城市", source: demandSource }));
    const data = await loadMatches(demoDemand.id);
    const html = render(data);
    assert.ok(html.includes("当前模拟资料中暂未找到符合条件的团队"));
    assert.ok(html.includes("不能据此判断是否存在真实可接单团队"));
    assert.ok(html.includes("服务方来源：模拟资料和样例评分"));
    assert.ok(html.includes('role="status"'));
    assert.ok(!html.includes("当前没有同城施工团队"));
    assert.ok(!html.includes("按匹配分从高到低排列"));
    const demo = html.match(/<details id="fulfillment-demo"[^>]*>([\s\S]*?)<\/details>/);
    assert.ok(demo, "模拟匹配应集中在折叠区域");
    assert.ok(!demo[1].includes("<article "), "模拟团队为空时不显示团队卡片");
    assert.ok(!/<details id="fulfillment-demo"[^>]*\bopen/.test(html));
    assert.ok(html.indexOf("domestic-case-recommendations") < html.indexOf("fulfillment-demo"));
    t.mock.restoreAll();
  }
});

test("live 空结果只说明本次资料没有候选，需求是 mock 也不把服务方误标为模拟", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider"
    ? success([]) : success({ ...demoDemand, source: "mock" }, "mock"));
  const html = render(await loadMatches(demoDemand.id));
  assert.ok(html.includes("本次返回的资料中暂未找到符合条件的团队"));
  assert.ok(html.includes("这不代表当地没有施工团队"));
  assert.ok(html.includes("服务方来源：服务方接口数据"));
  assert.ok(!html.includes("当前服务方接口仅提供模拟资料"));
});

test("有候选和空匹配均提供可用刷新入口，同一需求的详情与报价链接保留编码", async (t) => {
  const id = "需求/a?b#c%20";
  for (const rows of [providers, []]) {
    t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? success(rows, "mock") : success({ ...demoDemand, id }));
    const html = render(await loadMatches(id));
    assert.match(html, /<button[^>]*type="button"[^>]*>刷新匹配<\/button>/);
    assert.ok(!html.includes('disabled=""'));
    assert.ok(html.includes(`href="/owner/demand/${encodeURIComponent(id)}"`));
    assert.ok(html.includes(`href="/owner/quotes/${encodeURIComponent(id)}"`));
    if (rows.length) {
      assert.ok(html.includes("按匹配分从高到低排列"));
      assert.ok(html.includes("<article "));
      assert.ok(!html.includes("暂未找到符合条件的团队"));
    }
    t.mock.restoreAll();
  }
});

test("重新加载会重读需求和服务方，城市变化、候选补充及清空均更新结果", async (t) => {
  let demand: DemandDTO = { ...demoDemand, id: "refresh-demand", source: "live" };
  let rows = providers;
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return url === "/api/provider" ? success(rows, "mock") : success(demand);
  });
  assert.ok((await loadMatches(demand.id)).response.data.length > 0);
  demand = { ...demand, city: "新测试城市" };
  assert.deepEqual((await loadMatches(demand.id)).response.data, []);
  rows = [{ ...providers[0], id: "added-provider", city: demand.city }];
  assert.deepEqual((await loadMatches(demand.id)).response.data.map((match) => match.provider.id), ["added-provider"]);
  rows = [];
  assert.deepEqual((await loadMatches(demand.id)).response.data, []);
  assert.deepEqual(urls, Array.from({ length: 4 }, () => ["/api/demand/refresh-demand", "/api/provider"]).flat());
});

test("刷新遇到删除或 501 不回退旧候选或空成功，加载态禁用操作并隐藏候选", async (t) => {
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url: string) => status === 200
    ? success(url === "/api/provider" ? providers : demoDemand, "mock")
    : Response.json({ ok: false, error: { code: status === 404 ? "DEMAND_NOT_FOUND" : "NOT_IMPLEMENTED", message: "测试失败" } }, { status }));
  assert.ok((await loadMatches(demoDemand.id)).response.data.length > 0);
  status = 404;
  await assert.rejects(loadMatches(demoDemand.id), MatchDemandNotFound);
  status = 501;
  await assert.rejects(loadMatches(demoDemand.id), (error) => error instanceof ApiClientError && error.status === 501);
  const loading = renderToStaticMarkup(createElement(MatchPageContent, { state: { status: "loading" }, retry: () => undefined }));
  assert.ok(loading.includes('aria-busy="true"'));
  assert.ok(loading.includes('disabled=""'));
  assert.ok(!loading.includes("<article "));
});
