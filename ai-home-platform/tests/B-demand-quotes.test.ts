import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, envelope, type QuoteDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { demoDemand, providers, quotes } from "../src/lib/mock-data";
import { loadQuoteComparison, QuoteDemandNotFound, quoteLoadErrorMessage } from "../src/features/b/load-quotes";
import { QuoteComparison } from "../src/features/b/QuoteComparison";
import { QuotePage, QuotePageContent } from "../src/features/b/QuotePage";

const success = (data: unknown, source: "mock" | "live" = "live") => Response.json({ ok: true, data, meta: { source } });
const failure = (status: number, code: string) => Response.json({ ok: false, error: { code, message: "测试错误" } }, { status });

test("匿名 401 与服务方 403 分别提示，停止后续请求且不回退演示列表", async t => {
  for (const [status, code, message] of [[401, "UNAUTHENTICATED", "尚未登录业主账号或登录已失效"], [403, "FORBIDDEN", "服务方身份不能读取此列表"]] as const) {
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => {
      urls.push(url);
      return failure(status, code);
    });
    await assert.rejects(loadQuoteComparison("private-demand"), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      const html = renderToStaticMarkup(createElement(QuotePageContent, {
        state: { status: "error", message: quoteLoadErrorMessage(error) }, retry: () => undefined,
      }));
      assert.ok(html.includes(message));
      assert.ok(html.includes("重新加载"));
      assert.ok(!html.includes("<table "));
      assert.ok(!html.includes("本次读取完成"));
      assert.ok(!html.includes("暂无可对比"));
      assert.ok(!html.includes("测试错误"));
      return true;
    });
    assert.deepEqual(urls, ["/api/quote?demandId=private-demand"]);
    t.mock.restoreAll();
  }
});

test("显式查询返回跨需求或隐藏状态时拒绝整批数据，不能过滤成空成功", async t => {
  for (const invalid of [
    { ...quotes[0], demandId: "other-owner-demand" },
    { ...quotes[0], status: "draft" },
    { ...quotes[0], status: "rejected" },
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => success([quotes[0], invalid]));
    await assert.rejects(loadQuoteComparison(demoDemand.id), error => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
    assert.equal(fetch.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("刷新时权限失效不返回上次报价，重新登录后可重新读取", async t => {
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?")
    ? status === 200 ? success(quotes, "mock") : failure(status, "ACCESS_DENIED")
    : url === "/api/provider" ? success(providers, "mock") : success(demoDemand));
  assert.equal((await loadQuoteComparison(demoDemand.id)).response.data.length, 2);
  for (status of [401, 403]) await assert.rejects(loadQuoteComparison(demoDemand.id), error => error instanceof ApiClientError && error.status === status);
  status = 200;
  assert.equal((await loadQuoteComparison(demoDemand.id)).response.data.length, 2);
});

test("报价读取先查询 demandId，再读取需求和资料，保留已提交/接受报价并重算小计", async (t) => {
  const id = "saved-demand";
  const candidates: QuoteDTO[] = [
    { ...quotes[0], demandId: id, id: "submitted", knownTotalCents: 1 },
    { ...quotes[1], demandId: id, id: "accepted", status: "accepted" },
  ];
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    if (url.startsWith("/api/quote?demandId=")) return success(candidates, "mock");
    if (url === "/api/provider") return success(providers, "mock");
    return success({ ...demoDemand, id, source: "live" });
  });
  const data = await loadQuoteComparison(id);
  assert.deepEqual(urls, [`/api/quote?demandId=${id}`, `/api/demand/${id}`, "/api/provider"]);
  assert.deepEqual(data.response.data.map((value) => value.id), ["submitted", "accepted"]);
  assert.deepEqual(data.response.data.map((value) => value.knownTotalCents), [1200000, 1300000]);
  assert.equal(data.response.data[0].items[1].amountCents, null);
  assert.deepEqual(data.response.data[0].pendingItems, ["垃圾清运"]);
  assert.ok(envelope(Quote.array()).safeParse(data.response).success);
});

test("显式查询空结果正常显示暂无报价，不加载服务方或回退演示报价", async (t) => {
  const id = "saved-empty";
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    if (url.startsWith("/api/quote?demandId=")) return success([], "mock");
    if (url === "/api/provider") throw new Error("不应该查询服务方");
    return success({ ...demoDemand, id, source: "live" });
  });
  const data = await loadQuoteComparison(id);
  assert.deepEqual(data.response.data, []);
  assert.equal(data.providerSource, null);
  assert.deepEqual(urls, [`/api/quote?demandId=${id}`, `/api/demand/${id}`]);
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data }));
  for (const text of ["需求来源：已保存的需求数据", "报价查询整体来源：mock", "暂无可对比的报价"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("仍待接通"));
  assert.ok(!html.includes("<table "));
  assert.ok(!html.includes("¥12,000.00"));
  assert.ok(html.includes(`href="/owner/matches/${id}"`));
});

test("各数据源独立标识，混合来源不冒充全部 live，空 live 报价仍是正常空结果", async (t) => {
  for (const demandSource of ["mock", "live"] as const) {
    for (const quoteSource of ["mock", "live"] as const) {
      for (const providerSource of ["mock", "live"] as const) {
        t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?demandId=") ? success(quotes.map(quote => ({ ...quote, source: quoteSource })), quoteSource) : url === "/api/provider" ? success(providers, providerSource) : success({ ...demoDemand, source: demandSource }, demandSource));
        const data = await loadQuoteComparison(demoDemand.id);
        assert.equal(data.demandSource, demandSource);
        assert.equal(data.quoteSource, quoteSource);
        assert.equal(data.providerSource, providerSource);
        assert.equal(data.response.meta.source, [demandSource, quoteSource, providerSource].every((source) => source === "live") ? "live" : "mock");
        t.mock.restoreAll();
      }
    }
  }
  t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?demandId=") ? success([]) : success({ ...demoDemand, source: "live" }));
  const data = await loadQuoteComparison(demoDemand.id);
  assert.equal(data.response.meta.source, "live");
  const html = renderToStaticMarkup(createElement(QuoteComparison, { data }));
  assert.ok(html.includes("暂无可对比的报价"));
  assert.ok(!html.includes("模拟报价"));
});

test("报价页逐条需求来源独立于整体信封，有报价和空报价均不猜测缺失来源", async (t) => {
  for (const demandSource of ["mock", "live", undefined] as const) {
    for (const overallSource of ["mock", "live"] as const) {
      for (const rows of [quotes.map(quote => ({ ...quote, source: "live" })), []]) {
        t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?demandId=") ? success(rows)
          : url === "/api/provider" ? success(providers)
            : success({ ...demoDemand, source: demandSource }, overallSource));
        const data = await loadQuoteComparison(demoDemand.id);
        assert.equal(data.demandSource, demandSource);
        assert.equal(data.response.meta.source, demandSource === "live" && overallSource === "live" ? "live" : "mock");
        const html = renderToStaticMarkup(createElement(QuoteComparison, { data }));
        const label = demandSource === "mock" ? "模拟数据" : demandSource === "live" ? "已保存的需求数据" : "未知（接口未提供逐条来源）";
        assert.ok(html.includes(`需求来源：${label}`));
        assert.ok(html.includes("报价查询整体来源：live"));
        if (demandSource === undefined) {
          assert.ok(html.includes("需求来源：未知"));
          assert.ok(!html.includes("需求来源：已保存的需求数据"));
          assert.ok(!html.includes("需求来源：模拟数据"));
          assert.ok(!html.includes("整体响应含模拟数据"));
        }
        t.mock.restoreAll();
      }
    }
  }
});

test("报价读取拒绝非法逐条需求来源，不掩盖为来源未知", async (t) => {
  for (const source of ["unknown", null]) {
    t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?") ? success([]) : success({ ...demoDemand, source }));
    await assert.rejects(loadQuoteComparison(demoDemand.id), (error) => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
    t.mock.restoreAll();
  }
});

test("特殊 ID 精确编码，空 ID 不请求，响应 ID 错误立即失败", async (t) => {
  const id = " 需求/a?b#c%20&d=1 ";
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return url.startsWith("/api/quote?demandId=") ? success([]) : success({ ...demoDemand, id });
  });
  assert.equal((await loadQuoteComparison(id)).demand.id, id);
  assert.deepEqual(urls, [`/api/quote?demandId=${encodeURIComponent(id)}`, `/api/demand/${encodeURIComponent(id)}`]);
  const count = urls.length;
  for (const empty of ["", " "]) await assert.rejects(loadQuoteComparison(empty), (error) => error instanceof ApiClientError && error.code === "VALIDATION_ERROR");
  assert.equal(urls.length, count);
  await assert.rejects(loadQuoteComparison("other"), (error) => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
});

test("报价或详情的 DEMAND_NOT_FOUND 均隐藏不存在与非本人差异，其他 404 保留为错误", async (t) => {
  for (const stage of [`/api/quote?demandId=${demoDemand.id}`, `/api/demand/${demoDemand.id}`]) {
    t.mock.method(globalThis, "fetch", async (url: string) => url === stage ? failure(404, "DEMAND_NOT_FOUND") : url.startsWith("/api/quote?demandId=") ? success(quotes) : success(demoDemand));
    await assert.rejects(loadQuoteComparison(demoDemand.id), QuoteDemandNotFound);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => failure(404, "OTHER_NOT_FOUND"));
  await assert.rejects(loadQuoteComparison(demoDemand.id), ApiClientError);
});

test("需求或报价的 501/503/网络/坏 JSON/业务失败均中止，不产生空成功", async (t) => {
  const failures = [
    () => failure(501, "NOT_IMPLEMENTED"),
    () => failure(503, "DATABASE_UNAVAILABLE"),
    () => { throw new TypeError("network"); },
    () => new Response("bad json"),
    () => Response.json({ ok: false, error: { code: "FAILED", message: "失败" } }),
    () => Response.json({ ok: true, data: [], meta: { source: "unknown" } }),
    () => Response.json({ ok: true, data: {} }),
  ];
  for (const stage of [`/api/demand/${demoDemand.id}`, `/api/quote?demandId=${demoDemand.id}`]) {
    for (const reply of failures) {
      t.mock.method(globalThis, "fetch", async (url: string) => url === stage ? reply() : url.startsWith("/api/quote?demandId=") ? success(quotes) : success(demoDemand));
      await assert.rejects(loadQuoteComparison(demoDemand.id), ApiClientError);
      t.mock.restoreAll();
    }
  }
  assert.match(quoteLoadErrorMessage(new ApiClientError("", "NOT_IMPLEMENTED", 501)), /尚未开放/);
});

test("刷新重新读取需求和报价，删除后的 404 不保留上一份报价数据", async (t) => {
  let deleted = false;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.startsWith("/api/quote?demandId=")) return success(quotes, "mock");
    if (url === "/api/provider") return success(providers, "mock");
    return deleted ? failure(404, "DEMAND_NOT_FOUND") : success(demoDemand);
  });
  assert.equal((await loadQuoteComparison(demoDemand.id)).response.data.length, 2);
  deleted = true;
  await assert.rejects(loadQuoteComparison(demoDemand.id), QuoteDemandNotFound);
});

test("报价初始 HTML 不猜测来源并禁用重试，失败/未找到不显示旧表格", () => {
  const initial = renderToStaticMarkup(createElement(QuotePage, { demandId: "new-demand" }));
  assert.match(initial, /本人需求 · 报价对比/);
  assert.ok(!initial.includes("当前报价接口提供模拟数据"));
  assert.match(initial, /disabled=""/);
  assert.ok(!initial.includes("<table "));
  for (const state of [{ status: "not-found" }, { status: "error", message: "读取失败" }] as const) {
    const html = renderToStaticMarkup(createElement(QuotePageContent, { state, retry: () => undefined }));
    assert.ok(html.includes("重新加载"));
    assert.ok(!html.includes('disabled=""'));
    assert.ok(!html.includes("<table "));
  }
});
