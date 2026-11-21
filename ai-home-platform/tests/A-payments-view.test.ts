import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Payment } from "../src/contracts";
import {
  PaymentsContent,
  paymentConfirmationMessage,
  requestPaymentConfirmation,
} from "../src/features/a/PaymentsPanel";
import type { PaymentsState } from "../src/features/a/usePayments";

// 为 jsx:preserve 下的渲染测试提供 React，测试结束后恢复。
const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

// 仅供测试使用的模拟节点，字段由公共 Payment 契约校验。
const payment = Payment.parse({
  id: "test-payment", demandId: "test-demand", stage: "测试签约节点",
  amountCents: 123456, status: "confirmed_demo", simulated: true,
});
const ready = (items = [payment], source: "mock" | "live" = "mock"): PaymentsState => ({
  phase: "ready", items, source, error: null,
});
const render = (state: PaymentsState, id = payment.demandId) => renderToStaticMarkup(
  createElement(PaymentsContent, { id, state, reload() {} }),
);
const assertNoPlan = (html: string) => {
  assert.doesNotMatch(html, /计划付款总额|已确认金额|待确认金额|确认进度|付款计划自检|确认本节点|上传付款凭证|测试签约节点|其他需求节点|1,234\.56/);
};

test("全部节点属于另一需求时隐藏整份计划，不泄露金额、节点或操作", () => {
  const html = render(ready([{ ...payment, demandId: "other-demand" }]));
  assert.match(html, /返回付款节点与当前需求不一致/);
  assert.match(html, /不能证明当前需求没有付款计划/);
  assert.match(html, /接口来源：mock（模拟数据）/);
  assert.match(html, /重新加载/);
  assertNoPlan(html);
  assert.doesNotMatch(html, /other-demand/);
});

test("混合需求无论顺序都拒绝整份计划，不能只保留当前需求后继续汇总", () => {
  const other = { ...payment, id: "other-payment", demandId: "other-demand", stage: "其他需求节点" };
  for (const items of [[payment, other], [other, payment]]) {
    const html = render(ready(items));
    assert.match(html, /停止展示整份付款计划/);
    assertNoPlan(html);
  }
});

test("空响应仅说明未取得节点，不断言当前需求没有计划，来源和重试仍可见", () => {
  for (const source of ["mock", "live"] as const) {
    const html = render(ready([], source));
    assert.match(html, /接口没有返回付款节点/);
    assert.match(html, /空响应不能证明这条需求没有付款计划/);
    assert.match(html, new RegExp(`接口来源：${source}`));
    assert.match(html, /重新加载/);
    assert.doesNotMatch(html, /这条需求还没有付款计划/);
    assertNoPlan(html);
  }
});

test("全部节点匹配才展示金额与模拟确认状态，live 来源也不能变成真实付款", () => {
  for (const source of ["mock", "live"] as const) {
    const html = render(ready([payment], source));
    assert.match(html, /计划付款总额/);
    assert.match(html, /测试签约节点/);
    assert.match(html, /已确认（演示）/);
    assert.match(html, /全部为模拟数据/);
    assert.match(html, new RegExp(`接口来源：${source}；付款节点均为模拟节点，不代表实际付款`));
    assert.match(html, /确认本节点/);
    assert.doesNotMatch(html, /返回付款节点与当前需求不一致/);
  }
});

test("付款操作说明演示确认已接通，不再把 POST /api/payment 说成 501", () => {
  const pending = Payment.parse({
    id: "pending-payment", demandId: "test-demand", stage: "待确认节点",
    amountCents: 100000, status: "pending", simulated: true,
  });
  const html = render(ready([pending]));
  assert.match(html, /确认本节点/);
  assert.match(html, /只改变内存中的演示状态/);
  assert.match(html, /确认本节点前会弹出二次确认/);
  assert.doesNotMatch(html, /接口目前返回 501/);
});

test("付款确认先生成不可撤销提示，取消时不允许进入确认动作", () => {
  const message = paymentConfirmationMessage("签约节点", 123456);
  assert.match(message, /确认演示付款节点「签约节点」\（¥1,234\.56）吗/);
  assert.match(message, /不能撤销/);
  let calls = 0;
  assert.equal(requestPaymentConfirmation(() => { calls++; return false; }, "签约节点", 123456), false);
  assert.equal(calls, 1);
  assert.equal(requestPaymentConfirmation(() => { calls++; return true; }, "签约节点", 123456), true);
  assert.equal(calls, 2);
});

test("加载时显示统一静态说明，失败时显示 501 和重试，均不展示旧付款计划", () => {
  const loading = render({ ...ready(), phase: "loading" });
  assert.match(loading, /正在加载，模拟记录会单独标注/);
  assert.doesNotMatch(loading, /接口来源：mock|全部为模拟数据/);
  assertNoPlan(loading);
  const failed = render({ ...ready(), phase: "failed", error: "接口尚未开放（HTTP 501）" });
  assert.match(failed, /HTTP 501/);
  assert.match(failed, /重新加载/);
  assert.match(failed, /role="alert"/);
  assertNoPlan(failed);
});

test("不匹配与空状态的返回链接编码当前 ID，正常计划返回同一需求的施工进度", () => {
  const id = "需求/a?#";
  for (const state of [ready(), ready([])]) {
    assert.ok(render(state, id).includes(`/owner/demand/${encodeURIComponent(id)}`));
  }
  const html = render(ready([{ ...payment, demandId: id }]), id);
  assert.ok(html.includes(`/owner/project/${encodeURIComponent(id)}`));
});
