import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, type QuoteDTO, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { ProviderOrdersContent } from "../src/features/c/ProviderOrders";
import { loadProviderOrders, providerOrdersErrorMessage, type ProviderOrdersState } from "../src/features/c/provider-orders";

// 合成接口夹具；live 仅用于验证展示，不表示已接通生产身份或真实订单。
const baseQuote = Quote.parse({
  id: "C-source-quote", demandId: "C-source-demand", providerId: "C-source-provider", status: "submitted",
  items: [{ code: "repair", name: "维修", unit: "job", quantity: 1, unitPriceCents: 100, amountCents: 100, note: "测试夹具" }],
  knownTotalCents: 100, pendingItems: [], estimatedDays: 1,
});

function payload(data: QuoteDTO[], source: SourceDTO) {
  return { ok: true as const, data, meta: { source } };
}

function render(state: ProviderOrdersState) {
  return renderToStaticMarkup(createElement(ProviderOrdersContent, { state, onReload() {} }));
}

test("混合报价按每条 source 展示，保留整份列表来源且不推断是否保存", async (t) => {
  const data = [
    { ...baseQuote, id: "C-source-mock", source: "mock" as const },
    { ...baseQuote, id: "C-source-live", source: "live" as const },
    { ...baseQuote, id: "C-source-unknown" },
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, "/api/provider/quotes");
    return Response.json(payload(data, "mock"));
  });
  const response = await loadProviderOrders();
  assert.deepEqual(response.data, data);
  const html = render({ status: "ready", response });
  const cards = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
  assert.equal(cards.length, 3);
  for (const [index, expected] of ["模拟报价", "已保存报价", "报价来源待确认"].entries()) {
    assert.ok(cards[index].includes(expected), cards[index]);
    assert.equal((cards[index].match(/模拟报价|已保存报价|报价来源待确认/g) ?? []).length, 1);
  }
  assert.match(html, /含模拟报价/);
  assert.match(html, /模拟报价也会保存/);
  assert.match(html, /模拟报价已单独标注/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("逐条来源缺失时保持未知，不根据列表 live 或服务方编号升级来源", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload([
    { ...baseQuote, id: "C-legacy-demo-provider", providerId: "provider-a" },
    { ...baseQuote, id: "C-legacy-other-provider", providerId: "another-provider" },
  ], "live")));
  const response = await loadProviderOrders();
  const html = render({ status: "ready", response });
  assert.match(html, /已保存报价/);
  assert.equal((html.match(/报价来源待确认/g) ?? []).length, 2);
  assert.doesNotMatch(html, /报价来源：模拟标识|报价来源：实时标识/);
  assert.ok(response.data.every((quote) => quote.source === undefined));
});

test("非法逐条来源拒绝整份响应，不降级成未知或保留部分成功", async (t) => {
  for (const source of [null, "", "real", 1]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: true, meta: { source: "mock" }, data: [
        { ...baseQuote, id: "C-valid-mock", source: "mock" },
        { ...baseQuote, id: "C-invalid-source", source },
      ],
    }));
    await assert.rejects(loadProviderOrders(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      const html = render({ status: "error", message: providerOrdersErrorMessage(error) });
      assert.match(html, /本人报价数据格式异常/);
      assert.doesNotMatch(html, /报价来源：|报价列表来源：|<article/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("空列表与加载中不虚构逐条来源，mock 空态不声称已有模拟报价", () => {
  for (const source of ["mock", "live"] as const) {
    const html = render({ status: "ready", response: payload([], source) });
    assert.match(html, /当前服务方暂无报价记录/);
    assert.doesNotMatch(html, /报价来源：|<article/);
    if (source === "mock") {
      assert.match(html, /本次为空列表，演示身份查询标记为 mock；当前服务方没有已保存的报价/);
      assert.doesNotMatch(html, /本次报价列表含模拟数据|本次列表标记为 mock，可能包含/);
    } else {
      assert.match(html, /已保存报价/);
    }
  }
  const loading = render({ status: "loading" });
  assert.doesNotMatch(loading, /报价来源：|报价列表来源：|<article/);
});

test("HTTP 501 即使带合法逐条 live 来源也不能展示成功记录", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    payload([{ ...baseQuote, source: "live" }], "live"), { status: 501 },
  ));
  await assert.rejects(loadProviderOrders(), (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.status, 501);
    const html = render({ status: "error", message: providerOrdersErrorMessage(error) });
    assert.match(html, /本人报价查询尚未实现/);
    assert.doesNotMatch(html, /报价来源：|报价列表来源：|C-source-quote/);
    return true;
  });
});
