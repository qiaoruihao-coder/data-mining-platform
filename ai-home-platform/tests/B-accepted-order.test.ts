import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDemand, providers, quotes } from "../src/lib/mock-data";
import type { OrderSummaryDTO } from "../src/contracts";
import type { QuoteComparisonData } from "../src/features/b/accept-quote";
import { loadAcceptedOrder, acceptedOrderErrorMessage } from "../src/features/b/load-accepted-order";
import { QuoteOrderVerificationContent } from "../src/features/b/QuoteOrderVerification";
import { ApiClientError } from "../src/lib/api-client";

function fixture(): QuoteComparisonData {
  return { demand: { ...demoDemand, id: "owner / demand", status: "contracted", source: "live" },
    providers, demandSource: "live", quoteSource: "mock", providerSource: "mock",
    response: { ok: true, data: [{ ...quotes[0], demandId: "owner / demand", status: "accepted", source: "mock" }], meta: { source: "mock" } } };
}
function order(): OrderSummaryDTO {
  const data = fixture();
  return { id: "order-one", demandId: data.demand.id, acceptedQuoteId: data.response.data[0].id, providerId: data.response.data[0].providerId, status: "contracted", source: "mock" };
}
const response = (data: unknown, source = "mock") => Response.json({ ok: true, data, meta: { source } });

test("B 接单核实：只读精确编码的需求 ID，保留接单来源与报价金额", async t => {
  const calls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => { calls.push([path, init]); return response(order()); });
  const data = fixture();
  const before = structuredClone(data);
  assert.deepEqual((await loadAcceptedOrder(data)).data, order());
  assert.deepEqual(calls, [["/api/order?demandId=owner%20%2F%20demand", undefined]]);
  assert.deepEqual(data, before);
});

test("B 接单核实：null 是授权空结果，历史 accepted 不补造关系", async t => {
  const data = fixture();
  data.demand.status = "published";
  t.mock.method(globalThis, "fetch", async () => response(null, "live"));
  assert.equal((await loadAcceptedOrder(data)).data, null);
  data.demand.status = "contracted";
  await assert.rejects(loadAcceptedOrder(data), /未读到接单关系/);
  data.demand.status = "published";
  t.mock.method(globalThis, "fetch", async () => response(null, "mock"));
  await assert.rejects(loadAcceptedOrder(data), error => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
});

test("B 接单核实：错需求、错报价、错服务方、错状态、错来源与坏 DTO 均拒绝", async t => {
  for (const patch of [{ demandId: "other" }, { acceptedQuoteId: "other" }, { providerId: "other" }, { status: "in_progress" }, { source: "live" }, { id: "" }]) {
    t.mock.method(globalThis, "fetch", async () => response({ ...order(), ...patch }));
    await assert.rejects(loadAcceptedOrder(fixture()), error => error instanceof ApiClientError && error.code === "INVALID_RESPONSE");
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => response(order(), "live"));
  await assert.rejects(loadAcceptedOrder(fixture()), /不一致/);
});

test("B 接单核实：必须与唯一 accepted 报价对应，报价缺失/重复/状态变化均需重新核实", async t => {
  t.mock.method(globalThis, "fetch", async () => response(order()));
  for (const mutate of [
    (data: QuoteComparisonData) => { data.response.data = []; },
    (data: QuoteComparisonData) => { data.response.data.push({ ...data.response.data[0], id: "another" }); },
    (data: QuoteComparisonData) => { data.response.data[0].status = "submitted"; },
    (data: QuoteComparisonData) => { data.response.data[0].source = undefined; },
    (data: QuoteComparisonData) => { data.response.data[0].demandId = "other"; },
  ]) {
    const data = fixture(); mutate(data);
    await assert.rejects(loadAcceptedOrder(data), /不一致/);
  }
});

test("B 接单核实：contracted/in_progress/completed 均可按最新一致状态读取", async t => {
  for (const status of ["contracted", "in_progress", "completed"] as const) {
    const data = fixture(); data.demand.status = status;
    t.mock.method(globalThis, "fetch", async () => response({ ...order(), status }));
    assert.equal((await loadAcceptedOrder(data)).data?.status, status);
    t.mock.restoreAll();
  }
});

test("B 接单核实：401/403/404/501/503 与网络错误不返回空成功，不重试写入", async t => {
  for (const [status, message] of [[401, "登录已失效"], [403, "无权"], [404, "不存在"], [501, "尚未开放"], [503, "读取失败"]] as const) {
    let count = 0;
    t.mock.method(globalThis, "fetch", async (_path: string, init?: RequestInit) => {
      count++; assert.equal(init?.method, undefined);
      return Response.json({ ok: false, error: { code: "TEST_FAILURE", message: "合成失败" } }, { status });
    });
    await assert.rejects(loadAcceptedOrder(fixture()), error => acceptedOrderErrorMessage(error).includes(message));
    assert.equal(count, 1);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw Error("合成断网"); });
  await assert.rejects(loadAcceptedOrder(fixture()), error => acceptedOrderErrorMessage(error).includes("不等于没有接单"));
});

test("B 接单核实展示：已接本报价、其他报价、真实空态及错误明确分开", () => {
  const render = (data: OrderSummaryDTO | null, selectedQuoteId = order().acceptedQuoteId) => renderToStaticMarkup(createElement(QuoteOrderVerificationContent, {
    selectedQuoteId, state: { status: "ready", result: { ok: true, data, meta: { source: data?.source ?? "live" } } },
  }));
  assert.match(render(order()), /所选报价已有实际接单关系/);
  assert.match(render(order()), /mock/);
  assert.match(render(order(), "other-selection"), /已接受其他报价，不能改选/);
  assert.match(render(null), /尚无实际接单关系/);
  assert.doesNotMatch(render(null), /order-one/);
  const failed = renderToStaticMarkup(createElement(QuoteOrderVerificationContent, { selectedQuoteId: "q", state: { status: "error", message: "接单读取失败" } }));
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /核实成功|尚无实际接单关系|order-one/);
  for (const status of ["waiting", "loading"] as const) {
    const html = renderToStaticMarkup(createElement(QuoteOrderVerificationContent, { selectedQuoteId: "q", state: { status } }));
    assert.doesNotMatch(html, /核实成功|尚无实际接单关系|order-one/);
  }
});
