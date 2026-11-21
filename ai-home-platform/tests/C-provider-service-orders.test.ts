import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderSummary, type OrderSummaryDTO, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { ProviderServiceOrdersContent } from "../src/features/c/ProviderServiceOrders";
import Page from "../src/app/provider/orders/page";
import {
  loadProviderServiceOrders, providerServiceOrdersErrorMessage, type ProviderServiceOrdersState,
} from "../src/features/c/provider-service-orders";

// 合成记录仅用于测试；页面只显示经公共契约校验的服务端接单关系。
const order = OrderSummary.parse({ id: "C-order", demandId: "C-demand", providerId: "C-provider",
  acceptedQuoteId: "C-quote", status: "contracted", source: "mock" });
function payload(data: OrderSummaryDTO[] = [order], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: ProviderServiceOrdersState) {
  return renderToStaticMarkup(createElement(ProviderServiceOrdersContent, { state, onReload() {}, statusFilter: "all", onStatusFilterChange() {} }));
}

test("只读取无参数的本人接单接口，保留返回顺序、三状态和逐条来源", async t => {
  const data = OrderSummary.shape.status.options.map((status, index) => ({ ...order, id: `C-${2 - index}`,
    demandId: `d-${index}`, acceptedQuoteId: `q-${index}`, status, source: index === 1 ? "live" as const : "mock" as const }));
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/provider/orders");
    assert.equal(init, undefined);
    return Response.json(payload(data));
  });
  const response = await loadProviderServiceOrders();
  assert.deepEqual(response, payload(data));
  const html = render({ status: "ready", response });
  for (const text of ["已建立接单关系", "进行中", "已完成", "本次返回 3 条接单关系", "含模拟订单",
    "模拟订单", "已保存订单", "需求编号", "已接受报价编号", "服务方编号",
    "不代表成交时间顺序", "订单记录不代替合同、付款或验收", "刷新订单和报价"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<article\b/g) ?? []).length, 3);
  assert.ok(html.indexOf("订单编号：C-2") < html.indexOf("订单编号：C-0"));
  assert.equal(fetched.mock.callCount(), 1);
  for (const record of data) {
    assert.ok(html.includes(`href="/provider/demand/${encodeURIComponent(record.demandId)}"`));
    assert.ok(html.includes(`aria-label="查看关联需求 ${record.demandId}"`));
  }
  assert.equal((html.match(/<a\b/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<form|确认接单|开始施工|¥|天<|读取权限尚未开放/);
});

test("授权空列表才显示暂无接单，mock 和 live 来源不从记录数量推断", async t => {
  for (const source of ["mock", "live"] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([], source)));
    const html = render({ status: "ready", response: await loadProviderServiceOrders() });
    for (const text of ["当前服务方暂无接单关系", "暂无订单", "本次返回 0 条接单关系", "报价经业主确认并建立接单后"]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(source === "mock" ? "含模拟订单" : "已保存订单"));
    assert.doesNotMatch(html, /<article|本条接单来源：|href=/);
    fetched.mock.restore();
  }
});

test("加载期间禁用刷新，不展示旧列表、来源或空成功；原页面保留独立报价区", () => {
  const loading = render({ status: "loading" });
  assert.match(loading, /正在加载订单/);
  assert.match(loading, /disabled=""/);
  assert.doesNotMatch(loading, /本次返回|接单列表来源：|<article|暂无接单关系|href=/);
  const html = renderToStaticMarkup(createElement(Page));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /我的接单/);
  assert.match(html, /本人报价/);
  assert.match(html, /正在加载报价/);
  assert.match(html, /订单以“我的接单”为准/);
  assert.doesNotMatch(html, /真实接单流程仍待完成/);
});

test("401、403、501、503 保留错误语义，失败不会显示记录或泄露内部细节", async t => {
  for (const [status, expected] of [[401, "登录已失效"], [403, "业主登录不能代替服务方登录"], [501, "尚未实现"], [503, "暂时不可用"]] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "FAILURE", message: "内部数据库错误" } }, { status }));
    await assert.rejects(loadProviderServiceOrders(), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, status);
      const html = render({ status: "error", message: providerServiceOrdersErrorMessage(error) });
      for (const text of [expected, "重新加载接单", 'role="alert"']) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /内部数据库|C-order|暂无接单关系|本次返回|接单列表来源：|<article|href=/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("拒绝重复关系、需求或报价、缺失来源、报价冒充订单和非法状态", async t => {
  const second = { ...order, id: "second", demandId: "second-demand", acceptedQuoteId: "second-quote" };
  for (const body of [
    payload([order, order]), payload([order, { ...second, demandId: order.demandId }]),
    payload([order, { ...second, acceptedQuoteId: order.acceptedQuoteId }]),
    { ok: true, data: [order] }, { ...payload(), meta: { source: "unknown" } },
    { ...payload(), data: [{ ...order, source: undefined }] }, { ...payload(), data: [{ ...order, source: "unknown" }] },
    { ...payload(), data: [{ ...order, status: "accepted" }] }, { ...payload(), data: [{ ...order, acceptedQuoteId: "" }] },
    { ...payload(), data: [{ ...order, knownTotalCents: 100 }] }, { ...payload(), data: null },
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "未实现" } },
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadProviderServiceOrders(), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.match(providerServiceOrdersErrorMessage(error), /数据格式异常/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("501 伪成功、坏 JSON 和网络错误不能回退假订单；重试读取新的状态或空列表", async t => {
  const steps = [
    () => Response.json(payload()),
    () => Response.json(payload(), { status: 501 }),
    () => new Response("bad json", { status: 501 }),
    () => new Response("bad json"),
    () => { throw new TypeError("网络故障"); },
    () => Response.json(payload([{ ...order, status: "completed", source: "live" }], "mock")),
    () => Response.json(payload([], "live")),
  ];
  const fetched = t.mock.method(globalThis, "fetch", async () => steps.shift()!());
  assert.match(render({ status: "ready", response: await loadProviderServiceOrders() }), /已建立接单关系/);
  for (let index = 0; index < 4; index++) {
    await assert.rejects(loadProviderServiceOrders(), error => {
      const message = providerServiceOrdersErrorMessage(error);
      if (index < 2) assert.match(message, /尚未实现/);
      const html = render({ status: "error", message });
      assert.doesNotMatch(html, /<article|C-order|接单列表来源：|暂无接单关系/);
      return true;
    });
  }
  const updated = render({ status: "ready", response: await loadProviderServiceOrders() });
  assert.match(updated, /已完成/);
  assert.match(updated, /含模拟订单/);
  assert.match(updated, /已保存订单/);
  assert.doesNotMatch(updated, />已建立接单关系<|本条接单来源：模拟/);
  assert.match(render({ status: "ready", response: await loadProviderServiceOrders() }), /暂无接单关系/);
  assert.equal(fetched.mock.callCount(), 7);
});

test("长编号换行且按原样转义，不推导金额、日期或补造默认关联", () => {
  const html = render({ status: "ready", response: payload([{ ...order, id: '<script>alert("id")</script>',
    demandId: "需求/a?b#c", acceptedQuoteId: "<img src=x onerror=alert(1)>", providerId: "很长的服务方编号".repeat(30) }]) });
  for (const text of ["&lt;script&gt;", "&lt;img", "需求/a?b#c", "break-all", "展开订单可查看报价、费用和工期"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes(`href="/provider/demand/${encodeURIComponent("需求/a?b#c")}"`));
  assert.doesNotMatch(html, /<script|<img|demo-demand|provider-a|¥|已付款|最终总价|读取权限尚未开放/);
});
