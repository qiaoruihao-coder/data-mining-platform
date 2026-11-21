import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { quotes, demoDemand } from "../src/lib/mock-data";
import { isFixedDemoQuote, loadQuotePageData } from "../src/features/b/load-demo-quotes";
import { QuotePageContent } from "../src/features/b/QuotePage";
import { QuoteDemandNotFound } from "../src/features/b/load-quotes";
import { ApiClientError } from "../src/lib/api-client";
import { handleQuoteRead } from "../src/lib/quote-engine/read-request";

const success = (data: unknown = quotes, source = "mock") => Response.json({ ok: true, data, meta: { source } });

test("仅精确 demo-demand 是固定演示；其他 ID 不因名称相似或来源为 mock 放行", () => {
  assert.equal(isFixedDemoQuote("demo-demand"), true);
  for (const id of ["", " demo-demand", "demo-demand ", "DEMO-DEMAND", "demo-demand-other", "real-demand"]) assert.equal(isFixedDemoQuote(id), false);
});

test("固定演示只请求已有无参数报价入口，需求及服务方使用固定样例且全部 mock", async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { paths.push(url); return success(); });
  const data = await loadQuotePageData(demoDemand.id);
  assert.deepEqual(paths, ["/api/quote"]);
  assert.equal(data.demand.id, demoDemand.id);
  assert.equal(data.demand.source, "mock");
  assert.equal(data.demandSource, "mock");
  assert.equal(data.providerSource, "mock");
  assert.equal(data.quoteSource, "mock");
  assert.equal(data.response.meta.source, "mock");
  assert.deepEqual(data.response.data.map(quote => quote.knownTotalCents), [1200000, 1300000]);
  assert.equal(data.response.data[0].items[1].amountCents, null);
});

test("固定演示拒绝其他需求、live/缺省来源和非展示状态，不静默过滤", async t => {
  for (const [rows, source] of [
    [quotes, "live"], [[{ ...quotes[0], demandId: "private-demand" }], "mock"],
    [[{ ...quotes[0], source: "live" }], "mock"], [[{ ...quotes[0], source: undefined }], "mock"],
    [[{ ...quotes[0], status: "draft" }], "mock"], [[{ ...quotes[0], status: "rejected" }], "mock"],
  ] as const) {
    t.mock.method(globalThis, "fetch", async () => success(rows, source));
    await assert.rejects(loadQuotePageData(demoDemand.id), error => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
    t.mock.restoreAll();
  }
});

test("真实需求仍走受保护查询，401/403/404/501/503 都不回退演示", async t => {
  for (const id of ["real-demand", "demo-demand "]) for (const status of [401, 403, 404, 501, 503]) {
    const paths: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => {
      paths.push(url);
      return Response.json({ ok: false, error: { code: status === 404 ? "DEMAND_NOT_FOUND" : "TEST_FAILURE", message: "合成拒绝" } }, { status });
    });
    await assert.rejects(loadQuotePageData(id), error => status === 404 ? error instanceof QuoteDemandNotFound : error instanceof ApiClientError && error.status === status);
    assert.deepEqual(paths, [`/api/quote?demandId=${encodeURIComponent(id)}`]);
    t.mock.restoreAll();
  }
});

test("演示接口的 501/503/网络错误仍失败，不使用内嵌报价假装成功", async t => {
  for (const status of [501, 503]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "TEST_FAILURE", message: "合成故障" } }, { status }));
    await assert.rejects(loadQuotePageData(demoDemand.id), error => error instanceof ApiClientError && error.status === status);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(loadQuotePageData(demoDemand.id), error => error instanceof ApiClientError && error.code === "NETWORK_ERROR");
});

test("无参数 GET 实际固定数据路径不访问数据库，匿名显式 demo 查询仍拒绝", async () => {
  const db = { $transaction: async () => { throw new Error("固定演示不应访问数据库"); } };
  const fixed = await handleQuoteRead(new Request("http://localhost/api/quote"), db as never);
  assert.equal(fixed.status, 200);
  assert.equal((await fixed.json()).meta.source, "mock");
  // 显式查询仍由原授权器处理，不能因这个页面入口而变成公开数据库读取。
  const explicit = await handleQuoteRead(new Request("http://localhost/api/quote?demandId=demo-demand"));
  assert.equal(explicit.status, 401);
  assert.equal((await explicit.json()).ok, false);
});

test("演示页面醒目标注只读固定 mock，保留报价逐条来源和未知费用", async t => {
  t.mock.method(globalThis, "fetch", async () => success());
  const data = await loadQuotePageData(demoDemand.id);
  const html = renderToStaticMarkup(createElement(QuotePageContent, { state: { status: "ready", data, readAt: 0 }, retry: () => undefined, demo: true }));
  for (const text of ["固定演示 · mock · 只读", "固定样例报价，无需登录", "不是当前账号的真实报价", "展示 2 份固定模拟报价", "需求来源：模拟数据", "mock · 模拟报价", "待确认"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<table /g) ?? []).length, 2);
  assert.ok(!html.includes("已保存的需求数据"));
});
