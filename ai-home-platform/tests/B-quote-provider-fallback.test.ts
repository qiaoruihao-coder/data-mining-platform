import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceDTO } from "../src/contracts";
import { demoDemand, providers, quotes } from "../src/lib/mock-data";
import { loadQuoteComparison } from "../src/features/b/load-quotes";
import { QuotePageContent } from "../src/features/b/QuotePage";

// 全部响应均为合成测试数据；live 仅用于检验来源标识，不连接实际接口。
const success = (data: unknown, source: SourceDTO = "live") => Response.json({ ok: true, data, meta: { source } });
const failure = (status: number) => Response.json({ ok: false, error: { code: "FAILED", message: "private provider detail" } }, { status });
const render = (data: Awaited<ReturnType<typeof loadQuoteComparison>>) => renderToStaticMarkup(createElement(QuotePageContent, {
  state: { status: "ready", data, readAt: Date.UTC(2026, 10, 14) }, retry: () => undefined,
}));

test("服务方故障保留已校验报价及自身来源，名称按编号待确认，失败不冒充空成功", async t => {
  const failures = [
    ...[401, 403, 404, 500, 503].map(status => () => failure(status)),
    () => { throw new TypeError("private network detail"); },
    () => new Response("private invalid JSON"),
    () => success([{ ...providers[0], name: 123 }]),
    () => Response.json({ ok: true, data: providers, meta: { source: "invalid" } }),
    () => Response.json({ ok: true, data: providers }),
    () => failure(200),
  ];
  for (const source of ["mock", "live"] as const) {
    for (const reply of failures) {
      t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? reply()
        : url.startsWith("/api/quote?demandId=") ? success(quotes.map(quote => ({ ...quote, source })), source) : success({ ...demoDemand, source: "live" }));
      const data = await loadQuoteComparison(demoDemand.id);
      assert.equal(data.quoteSource, source);
      assert.equal(data.response.meta.source, source);
      assert.deepEqual(data.providers, []);
      assert.equal(data.providerSource, null);
      assert.match(data.providerWarning ?? "", /读取失败/);
      assert.deepEqual(data.response.data.map(quote => quote.id), quotes.map(quote => quote.id));
      assert.equal(data.response.data[0].knownTotalCents, 1200000);
      assert.equal(data.response.data[0].items[1].amountCents, null);
      const html = render(data);
      assert.equal((html.match(/<table /g) ?? []).length, 2);
      for (const text of ["服务方资料未读取成功", "来源未知", "刷新报价", "¥12,000.00", "待确认", 'role="alert"']) assert.ok(html.includes(text), text);
      for (const quote of quotes) assert.ok(html.includes(`服务方 ${quote.providerId}（名称待确认）`));
      for (const name of providers.map(provider => provider.name)) assert.ok(!html.includes(name));
      for (const text of ["private", "暂无可对比的报价", "服务方来源：模拟资料", "服务方来源：服务方接口数据"]) assert.ok(!html.includes(text), text);
      t.mock.restoreAll();
    }
  }
});

test("服务方 HTTP 501 即使携带合法数据或坏 JSON 仍显示未开放，不采用名称", async t => {
  for (const reply of [
    () => failure(501),
    () => Response.json({ ok: true, data: providers, meta: { source: "live" } }, { status: 501 }),
    () => new Response("bad json", { status: 501 }),
  ]) {
    t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? reply()
      : url.startsWith("/api/quote?demandId=") ? success(quotes, "mock") : success(demoDemand, "mock"));
    const data = await loadQuoteComparison(demoDemand.id);
    assert.match(data.providerWarning ?? "", /接口尚未开放/);
    assert.equal(data.providerSource, null);
    assert.deepEqual(data.providers, []);
    assert.ok(render(data).includes("服务方资料接口尚未开放"));
    t.mock.restoreAll();
  }
});

test("刷新按本次结果恢复或清除名称与警告，不复用上次成功的资料", async t => {
  let available = false;
  t.mock.method(globalThis, "fetch", async (url: string) => url === "/api/provider" ? available ? success(providers, "mock") : failure(503)
    : url.startsWith("/api/quote?demandId=") ? success(quotes) : success({ ...demoDemand, source: "live" }));
  const failed = await loadQuoteComparison(demoDemand.id);
  assert.ok(failed.providerWarning);
  available = true;
  const restored = await loadQuoteComparison(demoDemand.id);
  assert.equal(restored.providerWarning, undefined);
  assert.equal(restored.providerSource, "mock");
  assert.ok(render(restored).includes(providers[0].name));
  assert.ok(!render(restored).includes("服务方资料读取失败"));
  available = false;
  const failedAgain = await loadQuoteComparison(demoDemand.id);
  assert.ok(failedAgain.providerWarning);
  assert.deepEqual(failedAgain.providers, []);
  assert.ok(!render(failedAgain).includes(providers[0].name));
  assert.deepEqual(failedAgain.response.data, restored.response.data);
});

test("报价为空不请求服务方；有效空资料没有故障警告，但名称仍待确认", async t => {
  let rows = quotes;
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/provider") { providerCalls++; return success([], "mock"); }
    return url.startsWith("/api/quote?demandId=") ? success(rows, "mock") : success(demoDemand, "mock");
  });
  const unnamed = await loadQuoteComparison(demoDemand.id);
  assert.equal(unnamed.providerWarning, undefined);
  assert.equal(unnamed.providerSource, "mock");
  assert.ok(render(unnamed).includes("名称待确认"));
  rows = [];
  const empty = await loadQuoteComparison(demoDemand.id);
  assert.equal(providerCalls, 1);
  assert.equal(empty.providerWarning, undefined);
  assert.equal(empty.providerSource, null);
  assert.ok(render(empty).includes("暂无可对比的报价"));
});

test("需求或报价失败、坏明细和累计溢出仍拒绝整次读取，服务方补充逻辑不能兜底", async t => {
  for (const badQuotes of [
    () => failure(503),
    () => success([{ ...quotes[0], items: [{ ...quotes[0].items[0], amountCents: -1 }] }]),
    () => success([{ ...quotes[0], items: [
      { ...quotes[0].items[0], amountCents: Number.MAX_SAFE_INTEGER },
      { ...quotes[0].items[0], amountCents: 1 },
    ] }]),
  ]) {
    let providerCalls = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (url === "/api/provider") { providerCalls++; return success(providers); }
      return url.startsWith("/api/quote?demandId=") ? badQuotes() : success(demoDemand);
    });
    await assert.rejects(loadQuoteComparison(demoDemand.id));
    assert.equal(providerCalls, 0);
    t.mock.restoreAll();
  }
  const fetch = t.mock.method(globalThis, "fetch", async () => failure(401));
  await assert.rejects(loadQuoteComparison(demoDemand.id));
  assert.equal(fetch.mock.callCount(), 1);
});
