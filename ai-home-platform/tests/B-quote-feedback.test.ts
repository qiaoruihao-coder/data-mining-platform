import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuoteDTO, SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { demoDemand, providers, quotes } from "../src/lib/mock-data";
import { loadQuoteComparison, quoteLoadErrorMessage } from "../src/features/b/load-quotes";
import { QuotePageContent } from "../src/features/b/QuotePage";

const success = (data: unknown, source: SourceDTO = "live") => Response.json({ ok: true, data, meta: { source } });
const readAt = Date.UTC(2026, 10, 14, 8, 30);
const render = (data: Awaited<ReturnType<typeof loadQuoteComparison>>) => renderToStaticMarkup(createElement(QuotePageContent, {
  state: { status: "ready", data, readAt }, retry: () => undefined,
}));

test("完成反馈统计查询结果，整批来源不把所有报价说成模拟报价，空结果正常展示", async (t) => {
  for (const quoteSource of ["mock", "live"] as const) {
    for (const otherSource of ["mock", "live"] as const) {
      for (const rows of [quotes, []]) {
        t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?demandId=") ? success(rows, quoteSource)
          : url === "/api/provider" ? success(providers, otherSource)
            : success({ ...demoDemand, source: otherSource }, otherSource));
        const html = render(await loadQuoteComparison(demoDemand.id));
        const feedback = rows.length ? "展示 2 份已提交或已接受的报价" : "暂无可对比的已提交或已接受报价";
        assert.ok(html.includes(feedback), feedback);
        assert.ok(html.includes('aria-live="polite" aria-atomic="true"'));
        assert.ok(html.includes(`<time dateTime="${new Date(readAt).toISOString()}">`));
        assert.ok(html.includes("本次读取完成时间（本机时间）"));
        assert.ok(html.includes("不代表报价的提交时间"));
        assert.ok(html.includes("刷新报价"));
        assert.ok(!html.includes('disabled=""'));
        t.mock.restoreAll();
      }
    }
  }
});

test("重新读取后的反馈只统计当前需求的可对比报价，新增与清空都会改变数量", async (t) => {
  let rows: QuoteDTO[] = quotes;
  t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?demandId=") ? success(rows)
    : url === "/api/provider" ? success(providers, "mock") : success({ ...demoDemand, source: "live" }));
  assert.ok(render(await loadQuoteComparison(demoDemand.id)).includes("展示 2 份已提交或已接受的报价"));
  rows = [
    ...quotes,
    { ...quotes[0], id: "new-submitted" },
  ];
  assert.ok(render(await loadQuoteComparison(demoDemand.id)).includes("展示 3 份已提交或已接受的报价"));
  rows = [];
  const empty = render(await loadQuoteComparison(demoDemand.id));
  assert.ok(empty.includes("暂无可对比的已提交或已接受报价"));
  assert.ok(!empty.includes("<table "));
});

test("读取中、需求不存在和失败均没有完成时间或旧报价，501 不展示读取成功", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => url.startsWith("/api/quote?demandId=")
    ? Response.json({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "尚未开放" } }, { status: 501 })
    : success(demoDemand));
  await assert.rejects(loadQuoteComparison(demoDemand.id), (error) => error instanceof ApiClientError && error.status === 501);
  const message = quoteLoadErrorMessage(new ApiClientError("", "NOT_IMPLEMENTED", 501));
  for (const state of [{ status: "loading" }, { status: "not-found" }, { status: "error", message }] as const) {
    const html = renderToStaticMarkup(createElement(QuotePageContent, { state, retry: () => undefined }));
    assert.ok(!html.includes("<time "));
    assert.ok(!html.includes("本次读取完成"));
    assert.ok(!html.includes("<table "));
    assert.equal(html.includes('disabled=""'), state.status === "loading");
    if (state.status === "error") {
      assert.ok(html.includes('role="alert"'));
      assert.ok(html.includes("所需接口尚未开放"));
    }
  }
});
