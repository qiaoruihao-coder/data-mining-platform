import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, Review, type ReviewDTO } from "../src/contracts";
import { formToReviewInput, loadOwnerOrder, loadReviews, reviewErrorMessage, submitReview } from "../src/features/a/review";
import { ApiClientError } from "../src/lib/api-client";
import { ReviewPanelContent } from "../src/features/a/ReviewPanel";

Object.defineProperty(globalThis, "React", { configurable: true, value: React });

const review = Review.parse({
  id: "review-1", demandId: "demand-1", orderId: "order-1", providerId: "provider-1",
  rating: 5, comment: "施工沟通顺畅", source: "live",
});

function envelope<T>(data: T, source: "mock" | "live" = "live") {
  return { ok: true, data, meta: { source } };
}

const demand = Demand.parse({
  id: "demand-1", description: "厨房返修", city: "深圳", areaM2: 80,
  budgetMinCents: 4000000, budgetMaxCents: 6000000, renovationType: "repair",
  desiredDays: 45, status: "completed", source: "live",
});

test("评价输入复用公共契约并清理文字内容", () => {
  const input = formToReviewInput("demand-1", "provider-1", { rating: 4, comment: "  沟通及时  " });
  assert.deepEqual(input, { demandId: "demand-1", providerId: "provider-1", rating: 4, comment: "沟通及时" });
  assert.equal(Review.safeParse({ ...input, orderId: "client-order", source: "mock" }).success, false);
});

test("完工且读取到实际接单时显示评价表单，已评价时只读展示来源", () => {
  const order = { order: { id: "order-1", demandId: "demand-1", providerId: "provider-1", acceptedQuoteId: "quote-1", status: "completed" as const, source: "live" as const }, source: "live" as const };
  const formHtml = renderToStaticMarkup(createElement(ReviewPanelContent, { demand, order, reviews: { data: [], source: "live" } }));
  assert.match(formHtml, /提交服务评价/);
  assert.match(formHtml, /接单编号：order-1/);
  const existingHtml = renderToStaticMarkup(createElement(ReviewPanelContent, { demand, order, reviews: { data: [review], source: "live" } }));
  assert.match(existingHtml, /已提交评价/);
  assert.match(existingHtml, /实时接口（live）/);
  assert.doesNotMatch(existingHtml, /提交服务评价/);
});

test("读取订单与评价时精确编码需求 ID，并保留各自来源", async (t) => {
  const id = "需求/a?&#";
  const order = { id: "order-1", demandId: id, providerId: "provider-1", acceptedQuoteId: "quote-1", status: "completed", source: "live" } as const;
  const specialReview = Review.parse({ ...review, demandId: id, orderId: "order-special" });
  const request = t.mock.method(globalThis, "fetch", async (path: string) => {
    if (path === `/api/order?demandId=${encodeURIComponent(id)}`) return Response.json(envelope(order));
    assert.equal(path, `/api/review?demandId=${encodeURIComponent(id)}`);
    return Response.json(envelope<ReviewDTO[]>([specialReview]));
  });
  const loadedOrder = await loadOwnerOrder(id);
  const loadedReviews = await loadReviews(id);
  assert.equal(loadedOrder.order?.providerId, "provider-1");
  assert.equal(loadedReviews.data[0]?.id, "review-1");
  assert.equal(request.mock.callCount(), 2);
});

test("评价提交成功保留服务端评价和来源", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (_path: string, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { demandId: "demand-1", providerId: "provider-1", rating: 5, comment: "施工沟通顺畅" });
    return Response.json(envelope(review), { status: 201 });
  });
  const result = await submitReview("demand-1", "provider-1", { rating: 5, comment: "施工沟通顺畅" });
  assert.equal(result.kind, "created");
  if (result.kind === "created") assert.equal(result.source, "live");
  assert.equal(request.mock.callCount(), 1);
});

test("不确定结果先读取核实，已存在评价时不自动重提", async (t) => {
  let calls = 0;
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    calls += 1;
    if (init?.method === "POST") return Response.json({ ok: false, error: { code: "REVIEW_UNAVAILABLE", message: "暂不可用" } }, { status: 503 });
    assert.equal(path, "/api/review?demandId=demand-1");
    return Response.json(envelope([review]));
  });
  const result = await submitReview("demand-1", "provider-1", { rating: 5, comment: "施工沟通顺畅" });
  assert.equal(result.kind, "confirmed");
  assert.equal(calls, 2);
  assert.equal(request.mock.callCount(), 2);
});

test("501、401 和无核实的网络失败都不能生成成功", async (t) => {
  for (const [response, expected] of [
    [Response.json({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "未实现" } }, { status: 501 }), "尚未开放"],
    [Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "请登录" } }, { status: 401 }), "登录"],
  ] as const) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await submitReview("demand-1", "provider-1", { rating: 5, comment: "" });
    assert.notEqual(result.kind, "created");
    assert.match(reviewErrorMessage(new ApiClientError("x", "X", response.status)), new RegExp(expected));
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const result = await submitReview("demand-1", "provider-1", { rating: 5, comment: "" });
  assert.equal(result.kind, "uncertain");
});
