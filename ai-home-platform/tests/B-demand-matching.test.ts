import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, Match, envelope, type DemandDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { demoDemand, providers } from "../src/lib/mock-data";
import { loadMatches, MatchDemandNotFound, matchLoadErrorMessage } from "../src/features/b/load-matches";
import { MatchResults } from "../src/features/b/MatchResults";
import { MatchPage, MatchPageContent } from "../src/features/b/MatchPage";

const success = (data: unknown, source: "mock" | "live" = "live") => Response.json({ ok: true, data, meta: { source } });
const failure = (status: number, code: string) => Response.json({ ok: false, error: { code, message: "测试错误" } }, { status });

test("实际需求城市/改造类型参与匹配，不回退深圳演示结果", async (t) => {
  const demands: DemandDTO[] = [
    { ...demoDemand, id: "saved-sz", renovationType: "repair" },
    { ...demoDemand, id: "saved-gz", city: "广州", renovationType: "partial" },
    { ...demoDemand, id: "saved-sh", city: "上海" },
  ];
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    if (url === "/api/provider") return success(providers, "mock");
    const found = demands.find((demand) => url === `/api/demand/${demand.id}`);
    assert.ok(found);
    return success(found);
  });
  const sz = await loadMatches("saved-sz");
  assert.equal(sz.response.data[0].provider.id, "provider-b");
  assert.ok(sz.response.data[0].reasons.some((reason) => reason.includes("维修")));
  const gz = await loadMatches("saved-gz");
  assert.deepEqual(gz.response.data.map((match) => match.provider.id), ["provider-f"]);
  assert.equal(gz.demand.city, "广州");
  const sh = await loadMatches("saved-sh");
  assert.deepEqual(sh.response.data, []);
  assert.deepEqual(urls, ["/api/demand/saved-sz", "/api/provider", "/api/demand/saved-gz", "/api/provider", "/api/demand/saved-sh", "/api/provider"]);
  assert.ok(envelope(Match.array()).safeParse(gz.response).success);
});

test("分别保留需求与服务方来源，仅两个来源都 live 才标 live", async (t) => {
  for (const demandSource of ["mock", "live"] as const) {
    for (const providerSource of ["mock", "live"] as const) {
      t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? success(providers, providerSource) : success({ ...demoDemand, source: demandSource }, demandSource));
      const data = await loadMatches(demoDemand.id);
      assert.equal(data.demandSource, demandSource);
      assert.equal(data.providerSource, providerSource);
      assert.equal(data.response.meta.source, demandSource === "live" && providerSource === "live" ? "live" : "mock");
      t.mock.restoreAll();
    }
  }
});

test("需求标签只取逐条 source，缺失不由整体信封或演示 ID 推断", async (t) => {
  for (const demandSource of ["mock", "live", undefined] as const) {
    for (const overallSource of ["mock", "live"] as const) {
      t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider"
        ? success(providers)
        : success({ ...demoDemand, source: demandSource }, overallSource));
      const data = await loadMatches(demoDemand.id);
      assert.equal(data.demandSource, demandSource);
      assert.equal(data.response.meta.source, demandSource === "live" && overallSource === "live" ? "live" : "mock");
      const html = renderToStaticMarkup(createElement(MatchResults, { data }));
      const label = demandSource === "mock" ? "模拟数据" : demandSource === "live" ? "已保存的需求数据" : "未知（接口未提供逐条来源）";
      assert.ok(html.includes(`需求来源：${label}`));
      if (demandSource === undefined) {
        assert.ok(html.includes("需求来源未知 · 规则匹配"));
        assert.ok(!html.includes("需求来源：已保存的需求数据"));
        assert.ok(!html.includes("需求来源：模拟数据"));
      }
      t.mock.restoreAll();
    }
  }
});

test("非法逐条来源拒绝展示，不能当成缺失来源继续匹配", async (t) => {
  for (const source of ["unknown", null]) {
    t.mock.method(globalThis, "fetch", async () => success({ ...demoDemand, source }));
    await assert.rejects(loadMatches(demoDemand.id), (error) => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
    t.mock.restoreAll();
  }
});

test("ID 经过 URL 编码且必须与响应精确一致，空白 ID 不发送请求", async (t) => {
  const id = "需求/a?b#c%20";
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return url === "/api/provider" ? success([]) : success({ ...demoDemand, id });
  });
  const result = await loadMatches(id);
  assert.equal(result.demand.id, id);
  assert.equal(urls[0], `/api/demand/${encodeURIComponent(id)}`);
  const calls = urls.length;
  for (const empty of ["", " "]) await assert.rejects(loadMatches(empty), (error) => error instanceof ApiClientError && error.code === "VALIDATION_ERROR");
  assert.equal(urls.length, calls);
  await assert.rejects(loadMatches("another-id"), (error) => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
});

test("只有需求接口明确的 DEMAND_NOT_FOUND 才展示需求不存在", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { urls.push(url); return failure(404, "DEMAND_NOT_FOUND"); });
  await assert.rejects(loadMatches("unknown"), MatchDemandNotFound);
  assert.deepEqual(urls, ["/api/demand/unknown"]);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? failure(404, "DEMAND_NOT_FOUND") : success(demoDemand));
  await assert.rejects(loadMatches(demoDemand.id), (error) => error instanceof ApiClientError && !(error instanceof MatchDemandNotFound));
});

test("需求或服务方的 501/503/网络错误及非法响应均失败，不生成空匹配成功", async (t) => {
  const cases = [
    () => failure(501, "NOT_IMPLEMENTED"),
    () => failure(503, "DATABASE_UNAVAILABLE"),
    () => failure(500, "INTERNAL_ERROR"),
    () => { throw new TypeError("network unavailable"); },
    () => new Response("not json"),
    () => Response.json({ ok: true, data: {}, meta: { source: "live" } }),
    () => Response.json({ ok: true, data: demoDemand }),
    () => Response.json({ ok: false, error: { code: "FAILED", message: "失败" } }),
  ];
  for (const stage of ["demand", "provider"]) {
    for (const reply of cases) {
      t.mock.method(globalThis, "fetch", async (url: string) => {
        if (stage === "demand" || url === "/api/provider") return reply();
        return success(demoDemand);
      });
      await assert.rejects(loadMatches(demoDemand.id), ApiClientError);
      t.mock.restoreAll();
    }
  }
  assert.match(matchLoadErrorMessage(new ApiClientError("", "NOT_IMPLEMENTED", 501)), /尚未开放/);
  assert.match(matchLoadErrorMessage(new ApiClientError("", "DATABASE_UNAVAILABLE", 503)), /暂时不可用/);
});

test("匹配结果明确显示真实需求加模拟服务方，报价链接保留当前需求 ID", async (t) => {
  const demand = Demand.parse({ ...demoDemand, id: "new-demand", city: "上海", description: "测试实际需求", source: "live" });
  t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? success(providers, "mock") : success(demand));
  const data = await loadMatches(demand.id);
  const html = renderToStaticMarkup(createElement(MatchResults, { data }));
  for (const text of ["含模拟数据", "需求来源：已保存的需求数据", "服务方来源：模拟资料和样例评分", "测试实际需求", "暂未找到符合条件的团队"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('<article '));
  assert.ok(!html.includes('href="/owner/quotes/demo-demand"'));
  assert.ok(html.includes('href="/owner/quotes/new-demand"'));
  assert.ok(html.includes('href="/owner/demand/new-demand"'));
});

test("初始 HTML 披露模拟服务方，加载时禁用重试，失败和未找到无默认候选", () => {
  const loading = renderToStaticMarkup(createElement(MatchPage, { demandId: "new-demand" }));
  assert.match(loading, /服务方接口当前提供模拟资料/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /disabled=""/);
  for (const state of [{ status: "error", message: "数据服务暂时不可用" }, { status: "not-found" }] as const) {
    const html = renderToStaticMarkup(createElement(MatchPageContent, { state, retry: () => undefined }));
    assert.ok(!html.includes("<article "));
    assert.ok(!html.includes('disabled=""'));
    assert.ok(html.includes("重新加载"));
    assert.ok(html.includes(state.status === "error" ? state.message : "需求未找到"));
  }
});
