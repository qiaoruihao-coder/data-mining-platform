import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderSummary, Quote, type QuoteDTO, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { ProviderOrderQuote, ProviderOrderQuoteContent } from "../src/features/c/ProviderOrderQuote";
import { ProviderServiceOrdersContent } from "../src/features/c/ProviderServiceOrders";
import { loadProviderOrderQuote, providerOrderQuoteErrorMessage, type ProviderOrderQuoteState } from "../src/features/c/provider-order-quote";

// 合成记录仅供自动测试；运行时只从本人报价接口查询，不生成报价或接单。
const order = OrderSummary.parse({ id: "order-C", demandId: "需求/C?d#e", providerId: "provider-test",
  acceptedQuoteId: " quote/C?d#e ", status: "contracted", source: "mock" });
const quote = Quote.parse({ id: order.acceptedQuoteId, demandId: order.demandId, providerId: order.providerId,
  status: "accepted", source: "mock", knownTotalCents: 17, estimatedDays: 3, pendingItems: ["材料选型", "材料选型"],
  items: [
    { code: "free", name: "现场检查", unit: "job", quantity: 1, unitPriceCents: 0, amountCents: 0, note: "" },
    { code: "measure", name: "局部处理", unit: "m2", quantity: 0.145, unitPriceCents: 100, amountCents: 15, note: "保留记录金额" },
    { code: "material", name: "材料", unit: "piece", quantity: 2, unitPriceCents: null, amountCents: null, note: "选型后确认\n含运送" },
  ],
});
function payload(data: QuoteDTO[] = [quote], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: ProviderOrderQuoteState) {
  return renderToStaticMarkup(createElement(ProviderOrderQuoteContent, { state, onReload() {} }));
}

test("接单报价入口默认收起且可区分接单，不预加载报价；空态和失败不出现入口", t => {
  const fetched = t.mock.method(globalThis, "fetch", async () => { throw new Error("不应预加载"); });
  const html = renderToStaticMarkup(createElement(ProviderOrderQuote, { order }));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /查看已接受报价.*接单编号：order-C/s);
  const controls = html.match(/aria-controls="([^"]+)"/);
  assert.ok(controls);
  assert.ok(html.includes(`id="${controls[1]}"`));
  assert.doesNotMatch(html, /¥|关联报价查询来源|报价明细|正在读取/);
  for (const state of [{ status: "loading" as const }, { status: "error" as const, message: "未登录" },
    { status: "ready" as const, response: { ok: true as const, data: [], meta: { source: "mock" as const } } }]) {
    const page = renderToStaticMarkup(createElement(ProviderServiceOrdersContent, { state, onReload() {}, statusFilter: "all", onStatusFilterChange() {} }));
    assert.doesNotMatch(page, /<button[^>]*>查看已接受报价|aria-expanded/);
  }
  assert.equal(fetched.mock.callCount(), 0);
});

test("三种接单状态按原样精确关联报价，只请求无参数本人报价接口，保留数据", async t => {
  const other = { ...quote, id: "other-accepted", demandId: "other-demand" };
  const submitted = { ...quote, id: "submitted", status: "submitted" as const };
  const original = structuredClone(quote);
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/provider/quotes");
    assert.equal(init, undefined);
    return Response.json(payload([other, submitted, quote]));
  });
  for (const status of OrderSummary.shape.status.options) {
    const result = await loadProviderOrderQuote({ ...order, status });
    assert.deepEqual(result, { quote, source: "mock" });
    assert.doesNotMatch(render({ status: "ready", response: result }), /other-accepted|submitted/);
  }
  assert.equal(fetched.mock.callCount(), 3);
  assert.deepEqual(quote, original);
});

test("合法空列表或缺少目标报价不能回退到第一条、同需求的其他报价或零金额", async t => {
  for (const data of [[], [{ ...quote, id: quote.id.trim() }], [{ ...quote, id: "another" }]]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload(data)));
    await assert.rejects(loadProviderOrderQuote(order), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "ORDER_QUOTE_NOT_FOUND");
      const html = render({ status: "error", message: providerOrderQuoteErrorMessage(error) });
      assert.match(html, /未找到该接单的已接受报价/);
      assert.doesNotMatch(html, /¥|报价明细|报价来源：|已知金额小计/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("报价编号相同仍须核对需求、服务方、已接受状态及已知来源", async t => {
  const mismatches = [{ demandId: "other-demand" }, { providerId: "other-provider" }, { source: "live" },
    ...["draft", "submitted", "rejected"].map(status => ({ status }))];
  for (const patch of mismatches) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([Quote.parse({ ...quote, ...patch })])));
    await assert.rejects(loadProviderOrderQuote(order), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "ORDER_QUOTE_MISMATCH");
      assert.match(providerOrderQuoteErrorMessage(error), /关联|不一致/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("全列表先校验，重复编号或其他记录损坏不能被目标选择掩盖", async t => {
  for (const body of [payload([quote, quote]), { ...payload(), meta: { source: "unknown" } },
    { ...payload(), data: [quote, { ...quote, id: "bad", knownTotalCents: -1 }] },
    { ...payload(), data: [{ ...quote, source: "invalid" }] }, { ...payload(), data: null }]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadProviderOrderQuote(order), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.match(providerOrderQuoteErrorMessage(error), /数据格式异常/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("查询与逐条来源分别保留，兼容旧 DTO 缺来源时不升级为 live", async t => {
  for (const source of ["mock", "live", undefined] as const) {
    const record = { ...quote, source };
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([record], "mock")));
    const result = await loadProviderOrderQuote({ ...order, source: source ?? "mock" });
    assert.equal(result.quote.source, source);
    assert.equal(result.source, "mock");
    const html = render({ status: "ready", response: result });
    assert.match(html, /关联报价查询来源：模拟标识（mock）/);
    assert.ok(html.includes(source === undefined ? "报价来源待确认" : source === "live" ? "已保存报价" : "模拟报价"));
    fetched.mock.restore();
  }
  assert.match(render({ status: "ready", response: { quote: { ...quote, source: "live" }, source: "live" } }), /关联报价查询来源：已保存记录/);
});

test("金额与工期按原记录显示，零价、null、重复待确认项与转义保留", () => {
  const html = render({ status: "ready", response: { quote, source: "mock" } });
  for (const text of ["¥0.17", "¥0.15", "¥0.00", "0.145 平方米", "报价预计工期", "3 天", "完整总价未确定", "未知费用不按零计算", "不代表实际排期", "选型后确认\n含运送"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/材料选型/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<form|<input|确认接单|已付款/);
  const escaped = render({ status: "ready", response: { quote: { ...quote, id: "<script>alert(1)</script>", pendingItems: ["<img src=x onerror=alert(1)>"] }, source: "mock" } });
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(escaped, /&lt;img/);
  assert.doesNotMatch(escaped, /<script|<img/);
  const empty = render({ status: "ready", response: { quote: { ...quote, items: [], pendingItems: [] }, source: "mock" } });
  assert.match(empty, /未提供明细，无法确认/);
  assert.match(empty, /不能据此认定费用为零或已全部确认/);
  const unknown = render({ status: "ready", response: { quote: { ...quote, pendingItems: [] }, source: "mock" } });
  assert.match(unknown, /有，完整总价未确定/);
});

test("加载、错误和伪成功 501 不展示旧价格；重试读取新内容", async t => {
  const steps = [() => Response.json(payload()),
    ...[401, 403, 501, 503].map(status => () => Response.json(payload(), { status })),
    () => new Response("not JSON", { status: 501 }), () => new Response("not JSON"),
    () => { throw new TypeError("network"); },
    () => Response.json(payload([{ ...quote, knownTotalCents: 100, pendingItems: ["重新核实"] }]))];
  const fetched = t.mock.method(globalThis, "fetch", async () => steps.shift()!());
  assert.match(render({ status: "ready", response: await loadProviderOrderQuote(order) }), /¥0\.17/);
  const loading = render({ status: "loading" });
  assert.match(loading, /disabled=""/);
  assert.doesNotMatch(loading, /¥|报价明细|报价来源：|已知金额小计/);
  for (let index = 0; index < 7; index++) {
    await assert.rejects(loadProviderOrderQuote(order), error => {
      const html = render({ status: "error", message: providerOrderQuoteErrorMessage(error) });
      assert.match(html, /暂时无法核对关联报价|重新加载关联报价/);
      if (index === 2 || index === 4) assert.match(html, /尚未实现/);
      assert.doesNotMatch(html, /¥|报价明细|报价来源：|已知金额小计/);
      return true;
    });
  }
  const updated = render({ status: "ready", response: await loadProviderOrderQuote(order) });
  assert.match(updated, /¥1\.00|重新核实/);
  assert.doesNotMatch(updated, /¥0\.17/);
  assert.equal(fetched.mock.callCount(), 9);
});
