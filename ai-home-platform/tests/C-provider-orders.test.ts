import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote, type QuoteDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { ProviderOrdersContent } from "../src/features/c/ProviderOrders";
import {
  loadProviderOrders, providerOrdersErrorMessage, summarizeProviderOrders, type ProviderOrdersState,
} from "../src/features/c/provider-orders";

// 仅供测试的合成记录，运行页面不会回退到这些数据。
const quote = Quote.parse({
  id: "C-quote-order", demandId: "C-order-demand", providerId: "C-provider", status: "submitted",
  items: [{ code: "repair", name: "维修", unit: "job", quantity: 1, unitPriceCents: 10000, amountCents: 10000, note: "" }],
  knownTotalCents: 10000, pendingItems: [], estimatedDays: 5,
});

function payload(data: QuoteDTO[] = [quote], source: "mock" | "live" = "mock") {
  return { ok: true as const, data, meta: { source } };
}

function render(state: ProviderOrdersState) {
  return renderToStaticMarkup(createElement(ProviderOrdersContent, { state, onReload() {} }));
}

test("本人报价只调用会话过滤接口，不附带身份参数，完整保留四种报价状态", async (t) => {
  const data = (["draft", "submitted", "accepted", "rejected"] as const)
    .map((status) => ({ ...quote, id: `C-${status}`, status }));
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/provider/quotes");
    assert.equal(init, undefined);
    return Response.json(payload(data, "live"));
  });
  const response = await loadProviderOrders();
  assert.deepEqual(response.data, data);
  assert.deepEqual(summarizeProviderOrders(data), { draft: 1, submitted: 1, accepted: 1, rejected: 1 });
  const html = render({ status: "ready", response });
  for (const text of ["本人报价", "已保存报价", "草稿报价", "报价已提交", "报价已接受", "报价已拒绝", "报价服务方编号", "查看关联需求", "订单以“我的接单”为准", "按编号排列", "切换账号后需刷新报价"]) {
    assert.ok(html.includes(text), text);
  }
  assert.equal((html.match(/<article\b/g) ?? []).length, 4);
  assert.doesNotMatch(html, /已确认承接|尚未按已验证服务方身份过滤|刷新接单/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("鉴权成功的空列表说明本人尚无已保存报价，并保留来源", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload([], "mock")));
  const response = await loadProviderOrders();
  const html = render({ status: "ready", response });
  for (const text of ["当前服务方暂无报价记录", "含模拟报价", "本次已验证服务方会话", "前往需求大厅"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<li[^>]*>.*C-quote-order/);
  assert.deepEqual(summarizeProviderOrders(response.data), { draft: 0, submitted: 0, accepted: 0, rejected: 0 });
});

test("加载中禁用刷新；401/403/501/503 分别说明原因，不回退为成功空列表", async (t) => {
  const loading = render({ status: "loading" });
  assert.match(loading, /正在加载报价/);
  assert.match(loading, /disabled/);
  assert.doesNotMatch(loading, /C-quote-order|报价列表来源：/);
  for (const [status, message] of [[401, "尚未登录服务方账号或登录已失效"], [403, "业主登录不能代替服务方登录"], [501, "本人报价查询尚未实现"], [503, "本人报价服务暂时不可用"]] as const) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "FAILURE", message: "内部敏感信息" } }, { status }));
    await assert.rejects(loadProviderOrders(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, status);
      const html = render({ status: "error", message: providerOrdersErrorMessage(error) });
      for (const text of ["暂时无法加载本人报价", message, "重新加载", 'role="alert"']) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /内部敏感|C-quote-order|暂无报价记录|报价列表来源：|<article/);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test("拒绝缺失来源、重复编号、非法 DTO 与 200 失败信封，不保留部分记录", async (t) => {
  for (const body of [
    { ok: true, data: [quote] },
    payload([quote, quote]),
    payload([{ ...quote, status: "contracted" as QuoteDTO["status"] }]),
    payload([{ ...quote, knownTotalCents: -1 }]),
    { ok: false, error: { code: "UNAUTHENTICATED", message: "内部敏感信息" } },
  ]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadProviderOrders(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.match(providerOrdersErrorMessage(error), /本人报价数据格式异常/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("HTTP 501 携带成功信封或非 JSON 都不能被当作成功", async (t) => {
  for (const response of [Response.json(payload([quote]), { status: 501 }), new Response("not json", { status: 501 })]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(loadProviderOrders(), (error: unknown) => {
      assert.match(providerOrdersErrorMessage(error), /尚未实现/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("每次刷新重新查询，读取最新状态；撤销后拒绝和网络异常不返回旧报价", async (t) => {
  const responses = [
    Response.json(payload([quote])),
    Response.json(payload([{ ...quote, status: "accepted" }])),
    Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "请重新登录" } }, { status: 401 }),
    new Response("bad json"),
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, "/api/provider/quotes");
    if (!responses.length) throw new TypeError("网络异常");
    return responses.shift()!;
  });
  assert.equal((await loadProviderOrders()).data[0].status, "submitted");
  assert.equal((await loadProviderOrders()).data[0].status, "accepted");
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(loadProviderOrders(), (error: unknown) => {
      const html = render({ status: "error", message: providerOrdersErrorMessage(error) });
      assert.match(html, /重新加载/);
      assert.doesNotMatch(html, /<article|C-quote-order|报价列表来源：|暂无报价记录/);
      return true;
    });
  }
  assert.equal(fetchMock.mock.callCount(), 5);
});

test("报价编码需求编号，不提供写入或履约确认动作", () => {
  const html = render({ status: "ready", response: payload([{ ...quote, demandId: "需求/a?b#c" }]) });
  assert.match(html, /href="\/provider\/demand\/%E9%9C%80%E6%B1%82%2Fa%3Fb%23c"/);
  assert.doesNotMatch(html, /接单成功|确认接单|开始施工|<form/);
});

test("null 费用和空明细不冒充零元或全部定价；金额保留服务端的末位分", () => {
  for (const item of [{ ...quote.items[0], unitPriceCents: null }, { ...quote.items[0], amountCents: null }]) {
    const html = render({ status: "ready", response: payload([{ ...quote, items: [item], pendingItems: [] }]) });
    assert.match(html, /有，完整总价未确定/);
    assert.match(html, /小计不含待确认费用/);
    assert.doesNotMatch(html, /当前没有待确认费用/);
  }
  const empty = render({ status: "ready", response: payload([{ ...quote, items: [] }]) });
  assert.match(empty, /未提供明细，无法确认/);
  const zero = render({ status: "ready", response: payload([{ ...quote, knownTotalCents: 0 }]) });
  assert.match(zero, /¥0\.00/);
  const large = render({ status: "ready", response: payload([{ ...quote, knownTotalCents: Number.MAX_SAFE_INTEGER }]) });
  assert.match(large, /¥90,071,992,547,409\.91/);
});
