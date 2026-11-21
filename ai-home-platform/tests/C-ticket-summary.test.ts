import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ticket, type SourceDTO } from "../src/contracts";
import { AdminTicketSummary } from "../src/features/c/AdminTicketSummary";
import { AdminTicketsContent } from "../src/features/c/AdminTickets";
import { adminTicketsErrorMessage, loadAdminTickets, summarizeTickets, type AdminTicketsState } from "../src/features/c/admin-tickets";

// 合成工单只用于测试；页面使用经公共契约校验的接口列表。
const ticket = Ticket.parse({ id: "C-summary", demandId: "same-demand", description: "合成测试问题",
  category: "quality", status: "assigned", responsibleProviderId: null });
function payload(data = [ticket], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function page(state: AdminTicketsState) {
  return renderToStaticMarkup(createElement(AdminTicketsContent, { state, onReload() {} }));
}
function cells(html: string) {
  return [...html.matchAll(/<td\b[^>]*>(\d+)<\/td>/g)].map(match => Number(match[1]));
}

test("按工单分别计数全部分类和状态，同项目/服务方不去重且不修改输入", () => {
  const data = Object.freeze(Ticket.shape.category.options.flatMap(category =>
    Ticket.shape.status.options.map(status => Object.freeze({ ...ticket, id: `${category}-${status}`, category, status })),
  ));
  const summary = summarizeTickets(data);
  assert.equal(summary.total, 12);
  assert.deepEqual(summary.byStatus, { open: 4, assigned: 4, resolved: 4 });
  for (const category of Ticket.shape.category.options) {
    assert.deepEqual(summary.byCategory[category], { open: 1, assigned: 1, resolved: 1 });
  }
  assert.equal(Object.values(summary.byCategory).flatMap(counts => Object.values(counts)).reduce((sum, count) => sum + count, 0), 12);
  assert.equal(data[0].demandId, "same-demand");
});

test("未指定责任方不等于待处理，已有责任方也不改变接口状态", () => {
  const summary = summarizeTickets([
    ticket, { ...ticket, id: "still-assigned" },
    { ...ticket, id: "resolved", category: "payment", status: "resolved" },
    { ...ticket, id: "open", category: "attitude", status: "open", responsibleProviderId: "synthetic-provider" },
  ]);
  assert.deepEqual(summary.byStatus, { open: 1, assigned: 2, resolved: 1 });
  assert.deepEqual(summary.byCategory.quality, { open: 0, assigned: 2, resolved: 0 });
  assert.deepEqual(summary.byCategory.schedule, { open: 0, assigned: 0, resolved: 0 });
  assert.equal(summary.total, 4);
});

test("统计表展示四类三状态、小计和总计，并独立披露来源与列表范围", () => {
  for (const source of ["mock", "live"] as const) {
    const html = renderToStaticMarkup(createElement(AdminTicketSummary, { tickets: [ticket], source }));
    assert.deepEqual(cells(html), [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
    for (const label of ["质量问题", "工期问题", "费用问题", "服务态度", "待处理", "已分派", "已解决", "小计", "全部分类"]) assert.ok(html.includes(label), label);
    assert.match(html, /不随下方筛选改变/);
    assert.match(html, /同一需求的多张工单分别计数/);
    assert.match(html, /不代表平台全量数据/);
    assert.match(html, /不代表客户满意度、责任认定或处理绩效/);
    assert.match(html, /scope="col"/);
    assert.match(html, /scope="row"/);
    assert.match(html, /tabindex="0"/);
    assert.ok(html.includes(source === "mock" ? "概览来源：模拟标识（mock）" : "概览来源：已保存记录"));
    if (source === "live") assert.doesNotMatch(html, /模拟标识|接口标记为 mock/);
    assert.doesNotMatch(html, /<button|<form|%|评分|趋势/);
  }
});

test("成功空列表才展示全零概览；加载和失败不显示成功统计或来源", () => {
  for (const source of ["mock", "live"] as const) {
    const html = page({ status: "ready", response: payload([], source) });
    assert.equal(cells(html).length, 20);
    assert.ok(cells(html).every(count => count === 0));
    assert.match(html, /工单问题与状态概览/);
    assert.match(html, /本次列表暂无工单/);
    assert.match(html, /不代表平台没有历史售后问题/);
  }
  for (const state of [{ status: "loading" }, { status: "error", message: "服务暂时不可用" }] satisfies AdminTicketsState[]) {
    const html = page(state);
    assert.doesNotMatch(html, /工单问题与状态概览|概览来源：|<table|<td/);
  }
});

test("非法列表、重复工单、501 伪成功和网络失败不能产生零计数或旧概览", async t => {
  for (const send of [
    async () => Response.json(payload([ticket, ticket])),
    async () => Response.json({ ...payload(), data: [{ ...ticket, category: "unknown" }] }),
    async () => Response.json({ ...payload(), meta: { source: "unknown" } }),
    async () => Response.json(payload(), { status: 501 }),
    async () => new Response("bad json", { status: 503 }),
    async () => { throw new Error("network failed"); },
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", send);
    await assert.rejects(loadAdminTickets(), error => {
      const html = page({ status: "error", message: adminTicketsErrorMessage(error) });
      assert.doesNotMatch(html, /工单问题与状态概览|概览来源：|<table|本次列表暂无工单/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("刷新后统计与来源随接口结果更新，每次只读一次既有工单接口", async t => {
  const responses = [payload(), payload([{ ...ticket, category: "schedule", status: "resolved" }], "live"), payload([], "live")];
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/ticket");
    assert.equal(init, undefined);
    return Response.json(responses.shift());
  });
  const first = await loadAdminTickets();
  assert.equal(summarizeTickets(first.data).byCategory.quality.assigned, 1);
  const next = await loadAdminTickets();
  assert.equal(summarizeTickets(next.data).byCategory.quality.assigned, 0);
  assert.equal(summarizeTickets(next.data).byCategory.schedule.resolved, 1);
  assert.match(page({ status: "ready", response: next }), /概览来源：已保存记录/);
  assert.equal(summarizeTickets((await loadAdminTickets()).data).total, 0);
  assert.equal(fetched.mock.callCount(), 3);
});
