import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { quotes, demoDemand, providers } from "../src/lib/mock-data";
import { acceptQuote, acceptQuoteErrorMessage, acceptanceReadback, canAcceptQuote, type QuoteComparisonData } from "../src/features/b/accept-quote";
import { QuoteAcceptance } from "../src/features/b/QuoteAcceptance";
import { ApiClientError } from "../src/lib/api-client";

function fixture(): QuoteComparisonData {
  return {
    demand: { ...demoDemand, id: "owner-demand", status: "published", source: "live" },
    providers, demandSource: "live", quoteSource: "mock", providerSource: "mock",
    response: { ok: true, data: quotes.map(quote => ({ ...quote, demandId: "owner-demand", status: "submitted", source: "mock" })), meta: { source: "mock" } },
  };
}
function order() {
  const quote = fixture().response.data[0];
  return { id: "order-one", demandId: quote.demandId, providerId: quote.providerId, acceptedQuoteId: quote.id, status: "contracted", source: "mock" };
}

test("接受报价：200 重放与 201 首次成功均使用公共契约，只传三个字段且只 POST 一次", async t => {
  for (const status of [200, 201]) {
    const calls: unknown[] = [];
    t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
      calls.push({ path, method: init.method, body: JSON.parse(String(init.body)) });
      return Response.json({ ok: true, data: order(), meta: { source: "mock" } }, { status });
    });
    const quote = fixture().response.data[0];
    const before = structuredClone(quote);
    assert.deepEqual(await acceptQuote(quote), order());
    assert.deepEqual(calls, [{ path: "/api/order", method: "POST", body: { demandId: quote.demandId, quoteId: quote.id, confirmed: true } }]);
    assert.deepEqual(quote, before, "不改本地状态、金额或来源");
    t.mock.restoreAll();
  }
});

test("接受报价：拒绝错需求、错报价、错服务方、来源不一致和坏回执", async t => {
  for (const patch of [{ demandId: "other" }, { acceptedQuoteId: "other" }, { providerId: "other" }, { source: "live" }, { id: "" }, { status: "paid" }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: { ...order(), ...patch }, meta: { source: "mock" } }));
    await assert.rejects(acceptQuote(fixture().response.data[0]), error => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: order(), meta: { source: "live" } }));
  await assert.rejects(acceptQuote(fixture().response.data[0]), /不一致/);
});

test("接受报价：409、503、501 和网络错误都不重发、不当成功", async t => {
  for (const [status, code, message] of [[409, "ORDER_ALREADY_EXISTS", "已接受其他报价，不能改选"], [409, "ACCEPTED_QUOTE_CONFLICT", "历史已接受报价"], [503, "ORDER_UNAVAILABLE", "可能已保存"], [501, "NOT_IMPLEMENTED", "接口尚未开放"], [401, "UNAUTHORIZED", "登录已失效"], [403, "FORBIDDEN", "无权"], [404, "QUOTE_NOT_FOUND", "不存在"]] as const) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ ok: false, error: { code, message: "合成错误" } }, { status }); });
    await assert.rejects(acceptQuote(fixture().response.data[0]), error => acceptQuoteErrorMessage(error).includes(message));
    assert.equal(calls, 1);
    t.mock.restoreAll();
  }
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw Error("合成断网"); });
  await assert.rejects(acceptQuote(fixture().response.data[0]), error => acceptQuoteErrorMessage(error).includes("不会自动重发"));
  assert.equal(calls, 1);
});

test("接受报价：只有当前已发布需求的 submitted 报价可选，mock 不升级 live", () => {
  const data = fixture();
  assert.equal(canAcceptQuote(data, data.response.data[0]), true);
  assert.equal(canAcceptQuote(data, { ...data.response.data[0] }), false, "旧快照不能继续确认");
  for (const status of ["draft", "contracted", "in_progress", "completed"] as const) {
    data.demand.status = status;
    assert.equal(canAcceptQuote(data, data.response.data[0]), false);
  }
  data.demand.status = "published";
  data.response.data[1].status = "accepted";
  assert.equal(canAcceptQuote(data, data.response.data[0]), false);
  data.response.data[1].status = "submitted";
  data.response.data[0].source = undefined;
  assert.equal(canAcceptQuote(data, data.response.data[0]), false);
});

test("接受报价：固定演示与跨需求报价无写入口", () => {
  const data = fixture();
  data.demand.id = "demo-demand";
  data.response.data.forEach(quote => { quote.demandId = "demo-demand"; });
  assert.equal(canAcceptQuote(data, data.response.data[0]), false);
  data.demand.id = "other-demand";
  assert.equal(canAcceptQuote(data, data.response.data[0]), false);
});

test("接受报价：只在重新读取需求及报价状态一致时核实已接受", () => {
  const data = fixture();
  const quote = structuredClone(data.response.data[0]);
  assert.match(acceptanceReadback(data, quote), /尚未核实/);
  data.response.data[0].status = "accepted";
  assert.match(acceptanceReadback(data, quote), /尚未核实/);
  data.demand.status = "contracted";
  assert.match(acceptanceReadback(data, quote), /已核实/);
  data.response.data[0].source = "live";
  assert.match(acceptanceReadback(data, quote), /尚未核实/);
  data.response.data[0].status = "submitted";
  data.response.data[1].status = "accepted";
  assert.match(acceptanceReadback(data, quote), /已接受其他报价/);
  data.response.data[0].status = "accepted";
  assert.match(acceptanceReadback(data, quote), /尚未核实/);
});

test("接受报价：初始只展示选择按钮，未选择时没有最终确认按钮，空数据不显示写入口", () => {
  const render = (data: QuoteComparisonData | null) => renderToStaticMarkup(createElement(QuoteAcceptance, { data, onBusy: () => undefined, refresh: () => undefined }));
  const data = fixture();
  assert.match(render(data), /选择报价/);
  assert.doesNotMatch(render(data), /确认接受此报价/);
  data.demand.status = "contracted";
  assert.doesNotMatch(render(data), /<button/);
  assert.equal(render(null), "");
});
