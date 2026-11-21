import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand } from "../src/contracts";
import { DemandDetailContent } from "../src/features/a/DemandDetailPanel";
import { ReviewPanelContent } from "../src/features/a/ReviewPanel";

Object.defineProperty(globalThis, "React", { configurable: true, value: React });

const demand = Demand.parse({
  id: "A-review-demand", description: "厨房返修", city: "深圳", areaM2: 80,
  budgetMinCents: 4000000, budgetMaxCents: 6000000, renovationType: "repair",
  desiredDays: 45, status: "in_progress", source: "live",
});

function render(status: typeof demand.status) {
  return renderToStaticMarkup(createElement(DemandDetailContent, {
    id: demand.id,
    state: { phase: "ready", demand: { ...demand, status }, source: "live" },
    reload() {},
  }));
}

function renderReview(status: typeof demand.status) {
  return renderToStaticMarkup(createElement(ReviewPanelContent, { demand: { ...demand, status } }));
}

test("未完成需求只显示完成后评价说明，不出现评价提交入口", () => {
  for (const status of ["published", "contracted", "in_progress"] as const) {
    const html = renderReview(status);
    assert.match(html, /需求完成后可评价/);
    assert.doesNotMatch(html, /提交评价|评价内容|评分/);
  }
});

test("已完工需求保持诚实的评价前置条件，不虚构评价对象或成功结果", () => {
  const html = renderReview("completed");
  assert.match(html, /需求已完工/);
  assert.match(html, /不会虚构评价对象或提交结果/);
  assert.doesNotMatch(html, /提交评价|评价内容|评分/);
});

test("草稿需求不提前显示售后或评价入口", () => {
  const html = render("draft");
  assert.doesNotMatch(html, /售后工单|服务评价|需求完成后可评价/);
});

test("公开需求详情首屏不泄露评价面板，需先通过本人权限预检", () => {
  const html = render("in_progress");
  assert.doesNotMatch(html, /服务评价|需求完成后可评价|评价对象/);
});
