import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderDTO } from "../src/contracts";
import { demoDemand, providers } from "../src/lib/mock-data";
import { ApiClientError } from "../src/lib/api-client";
import { loadMatches } from "../src/features/b/load-matches";
import { MatchResults } from "../src/features/b/MatchResults";
import { MatchPage } from "../src/features/b/MatchPage";

// 合成读取夹具；不修改共享样例、评价或数据库。
function directory(source: "mock" | "live", averageRating: number | null): ProviderDTO[] {
  return [{ ...providers[0], source: "mock", performance: {
    basis: "completed_order_review_average", averageRating, reviewCount: averageRating === null ? 0 : 3,
    calculatedAt: "2026-11-14T00:00:00Z", source,
  } }];
}

test("缺省 live 不补模拟评价；显式 mock 使用现有查询参数，切回 live 恢复无样本", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (path: string) => {
    urls.push(path);
    return Response.json({ ok: true, data: path.startsWith("/api/demand/") ? demoDemand
      : path.includes("performanceSource=mock") ? directory("mock", 4.67) : directory("live", null), meta: { source: "mock" } });
  });
  for (const source of [undefined, "mock", "live"] as const) {
    const result = await loadMatches(demoDemand.id, source);
    assert.equal(result.performanceSource, source ?? "live");
    assert.equal(result.response.data[0].provider.performance?.averageRating, source === "mock" ? 4.67 : null);
    const html = renderToStaticMarkup(createElement(MatchResults, { data: result }));
    assert.ok(html.includes(source === "mock" ? "当前显式查询 mock 模拟接单评价" : "当前默认查询 live 评价"));
    assert.equal(html.includes("当前默认查询 live 评价"), source !== "mock");
  }
  assert.deepEqual(urls.filter(url => url.startsWith("/api/provider")), ["/api/provider", "/api/provider?performanceSource=mock", "/api/provider"]);
});

test("服务方评价来源错位时拒绝整批响应，不展示所选口径以外的评价", async t => {
  let source: "mock" | "live" = "mock";
  t.mock.method(globalThis, "fetch", async (path: string) => Response.json({ ok: true,
    data: path.startsWith("/api/demand/") ? demoDemand : directory(source, 4.67), meta: { source: "mock" } }));
  await assert.rejects(loadMatches(demoDemand.id, "live"), (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
  source = "live";
  await assert.rejects(loadMatches(demoDemand.id, "mock"), (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
});

test("mock 无样本仍保留 null/0/mock，不补基础资料评分", async t => {
  t.mock.method(globalThis, "fetch", async (path: string) => Response.json({ ok: true,
    data: path.startsWith("/api/demand/") ? demoDemand : directory("mock", null), meta: { source: "mock" } }));
  const result = await loadMatches(demoDemand.id, "mock");
  assert.equal(result.response.data[0].provider.performance?.averageRating, null);
  assert.equal(result.response.data[0].provider.performance?.source, "mock");
});

test("mock 查询 501 伪成功、503 和网络失败都拒绝，不回退 live 或内嵌样例", async t => {
  for (const status of [501, 503, 0]) {
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (path: string) => {
      urls.push(path);
      if (path.startsWith("/api/demand/")) return Response.json({ ok: true, data: demoDemand, meta: { source: "mock" } });
      if (!status) throw Error("synthetic network error");
      return Response.json({ ok: true, data: directory("mock", 4.67), meta: { source: "mock" } }, { status });
    });
    await assert.rejects(loadMatches(demoDemand.id, "mock"));
    assert.deepEqual(urls, ["/api/demand/demo-demand", "/api/provider?performanceSource=mock"]);
    t.mock.restoreAll();
  }
});

test("非法评价口径在请求前按公共查询契约拒绝", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw Error("should not fetch"); });
  await assert.rejects(loadMatches(demoDemand.id, "other" as "mock"), (error: unknown) => error instanceof ApiClientError && error.code === "VALIDATION_ERROR");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("只有精确固定演示需求提供口径选择，默认 live 且模拟说明可见", () => {
  const html = renderToStaticMarkup(createElement(MatchPage, { demandId: "demo-demand" }));
  assert.match(html, /评价统计来源（固定演示页）/);
  assert.match(html, /value="live" selected=""/);
  assert.match(html, /mock · 模拟接单评价（演示）/);
  assert.match(html, /不代表真实口碑/);
  for (const demandId of ["saved-demand", "demo-demand-copy"]) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(MatchPage, { demandId })), /match-performance-source/);
  }
});
