import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ticket, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { AdminTicketsContent } from "../src/features/c/AdminTickets";
import {
  adminTicketsErrorMessage, filterTickets, loadAdminTickets, ticketCategoryFilterLabels,
  ticketStatusFilterLabels, type AdminTicketsState,
} from "../src/features/c/admin-tickets";

// 仅测试使用的合成工单，运行页面只读公共接口，不生成或回退到这些记录。
const ticket = Ticket.parse({
  id: "C-ticket-test", demandId: "C-demand-test", description: "测试墙面问题，待现场核实。",
  category: "quality", responsibleProviderId: "C-provider-test", status: "assigned",
});
function payload(data: ReturnType<typeof Ticket.parse>[] = [ticket], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: AdminTicketsState) {
  return renderToStaticMarkup(createElement(AdminTicketsContent, { state, onReload() {} }));
}

test("工单列表仅调用公共 GET，保留契约字段、顺序和来源", async (t) => {
  const data = [ticket, { ...ticket, id: "another-ticket", demandId: "another-demand", status: "open" as const }];
  const fetchMock = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/ticket");
    assert.equal(init?.method, undefined);
    assert.equal(init?.body, undefined);
    return Response.json(payload(data, "live"));
  });
  assert.deepEqual(await loadAdminTickets(), payload(data, "live"));
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("模拟工单披露整批来源、只读和鉴权边界，保留项目及服务方关联", () => {
  const html = render({ status: "ready", response: payload() });
  for (const text of [
    "工单列表来源：含模拟数据", "不能据此认定真实售后已受理或已解决", "来源标识针对整份列表",
    "本页仅供查看", "查看范围取决于登录账号", "本次返回 1 条工单", "工单编号：C-ticket-test",
    "筛选当前列表", "当前显示 1 / 1 条工单", "关键词", "工单、需求或服务方编号", "问题分类", "当前状态", "全部分类", "全部状态",
    "测试墙面问题", "质量问题", "已分派", "C-provider-test", "需求编号：C-demand-test",
    'href="/admin/demand/C-demand-test"', "查看工单 C-ticket-test 的关联需求",
  ]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /工单列表来源：实时接口|<form|<textarea|提交成功|派单成功/);
  assert.match(html, /<select/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1); // 只有刷新，不提供写入动作。
});

test("分类和状态筛选组合使用公共 Ticket 字段，不修改原始列表", () => {
  const data = [
    ticket,
    { ...ticket, id: "schedule-open", category: "schedule" as const, status: "open" as const },
    { ...ticket, id: "quality-resolved", status: "resolved" as const },
  ];
  const original = structuredClone(data);
  assert.deepEqual(filterTickets(data, "all", "all"), data);
  assert.deepEqual(filterTickets(data, "quality", "assigned").map((item) => item.id), [ticket.id]);
  assert.deepEqual(filterTickets(data, "schedule", "resolved"), []);
  assert.deepEqual(data, original);
  assert.equal(ticketCategoryFilterLabels.all, "全部分类");
  assert.equal(ticketStatusFilterLabels.all, "全部状态");
});

test("关键词筛选只匹配工单、需求和责任服务方编号，并可与分类状态组合", () => {
  const data = [
    ticket,
    { ...ticket, id: "schedule-open", demandId: "another-demand", category: "schedule" as const, status: "open" as const, responsibleProviderId: "provider-b" },
    { ...ticket, id: "quality-resolved", demandId: "third-demand", status: "resolved" as const, responsibleProviderId: null },
  ];
  const original = structuredClone(data);
  assert.deepEqual(filterTickets(data, "all", "all", " C-PROVIDER-TEST ").map((item) => item.id), [ticket.id]);
  assert.deepEqual(filterTickets(data, "all", "all", "another-demand").map((item) => item.id), ["schedule-open"]);
  assert.deepEqual(filterTickets(data, "quality", "resolved", "third-demand").map((item) => item.id), ["quality-resolved"]);
  assert.deepEqual(filterTickets(data, "all", "all", "not-found"), []);
  assert.deepEqual(data, original);
});

test("四种分类与三种状态使用中文，状态不推导责任服务方", () => {
  const data = Ticket.shape.category.options.map((category, index) => ({
    ...ticket, id: `category-${index}`, category, responsibleProviderId: null,
    status: Ticket.shape.status.options[index % 3],
  }));
  const html = render({ status: "ready", response: payload(data) });
  for (const text of ["质量问题", "工期问题", "费用问题", "服务态度", "待处理", "已分派", "已解决"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/暂未指定责任服务方/g) ?? []).length, 4);
  assert.doesNotMatch(html, /C-provider-test|>null<|>undefined<|全部已处理/);
});

test("关联需求按每张工单的 ID 编码，缺少责任服务方不使用演示默认值", () => {
  const data = [
    { ...ticket, demandId: "需求/a b?c#d%", responsibleProviderId: null },
    { ...ticket, id: "ticket-2", demandId: "different-demand", responsibleProviderId: "provider-2" },
  ];
  const html = render({ status: "ready", response: payload(data) });
  assert.ok(html.includes(`href="/admin/demand/${encodeURIComponent(data[0].demandId)}"`));
  assert.match(html, /href="\/admin\/demand\/different-demand"/);
  assert.match(html, /暂未指定责任服务方/);
  assert.match(html, /provider-2/);
  assert.doesNotMatch(html, /demo-demand|provider-a|C-provider-test|\/provider\/demand\/|\/owner\/demand\//);
});

test("live 列表使用接口来源，不标为模拟记录或已鉴权", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload([ticket], "live")));
  const html = render({ status: "ready", response: await loadAdminTickets() });
  assert.match(html, /工单列表来源：已保存记录/);
  assert.match(html, /来源标识不代表已完成身份鉴权/);
  assert.doesNotMatch(html, /工单列表来源：含模拟|本次列表含模拟数据|接口来源标记为 mock/);
});

test("空列表保留 mock/live 来源，零数量不等于平台没有历史售后", async (t) => {
  for (const source of ["mock", "live"] as const) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(payload([], source)));
    const html = render({ status: "ready", response: await loadAdminTickets() });
    for (const text of ["本次返回 0 条工单", "本次列表暂无工单", "不代表平台没有历史售后问题", "刷新工单"]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(source === "mock" ? "工单列表来源：模拟标识（mock）" : "工单列表来源：已保存记录"));
    assert.doesNotMatch(html, /<article|本次列表含模拟数据|工单列表来源：含模拟/);
    fetchMock.mock.restore();
  }
});

test("加载中禁用刷新、披露可能有模拟数据，不提前展示零数量或成功来源", () => {
  const html = render({ status: "loading" });
  for (const text of ["模拟记录已单独标注", "正在读取售后工单", 'disabled=""', 'role="status"']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<article|本次返回 \d+ 条工单|本次列表暂无工单|工单列表来源：|查看关联需求/);
});

test("描述缺失有占位，恶意文本被转义，长编号和多行描述可换行", () => {
  const html = render({ status: "ready", response: payload([
    { ...ticket, id: '<script>alert("id")</script>', description: "<img src=x onerror=alert(1)>\n第二行", responsibleProviderId: "<b>服务方</b>" },
    { ...ticket, id: "empty-description", description: "  \n " },
  ]) });
  for (const text of ["&lt;script&gt;", "&lt;img", "&lt;b&gt;", "第二行", "暂未填写问题描述", "break-all", "whitespace-pre-wrap"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script|<img|<b>/);
});

test("拒绝缺失来源、坏字段、重复编号和 200 失败信封，不伪造成空列表", async (t) => {
  for (const body of [
    { ok: true, data: [ticket] }, { ...payload(), meta: { source: "unknown" } },
    { ...payload(), data: null }, { ...payload(), data: [{ ...ticket, category: "other" }] },
    { ...payload(), data: [{ ...ticket, status: "closed" }] },
    { ...payload(), data: [{ ...ticket, responsibleProviderId: 42 }] },
    { ...payload(), data: [{ ...ticket, demandId: "" }] }, payload([ticket, ticket]),
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "未实现" } },
  ]) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadAdminTickets(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "INVALID_RESPONSE");
      const html = render({ status: "error", message: adminTicketsErrorMessage(error) });
      assert.match(html, /工单数据格式异常/);
      assert.doesNotMatch(html, /<article|本次返回 \d+ 条工单|本次列表暂无工单|工单列表来源：/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("401、403、501、503 显示可重试失败，不泄露内部错误", async (t) => {
  for (const [status, message] of [[401, "身份验证"], [403, "无权查看"], [501, "尚未实现"], [503, "暂时不可用"]] as const) {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
      ok: false, error: { code: "TEST_FAILURE", message: "内部敏感错误细节" },
    }, { status }));
    await assert.rejects(loadAdminTickets(), (error: unknown) => {
      const html = render({ status: "error", message: adminTicketsErrorMessage(error) });
      for (const text of [message, 'role="alert"', "重新加载"]) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /<article|本次返回 \d+ 条工单|本次列表暂无工单|工单列表来源：|内部敏感/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("HTTP 501 即使带成功信封或坏 JSON 仍为未实现，网络失败不会回退模拟工单", async (t) => {
  for (const failure of [
    async () => Response.json(payload(), { status: 501 }),
    async () => new Response("not json", { status: 501 }),
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("not json"),
    async () => Response.json(payload(), { status: 500 }),
  ]) {
    const fetchMock = t.mock.method(globalThis, "fetch", failure);
    await assert.rejects(loadAdminTickets(), (error: unknown) => {
      const message = adminTicketsErrorMessage(error);
      if (error instanceof ApiClientError && error.status === 501) assert.match(message, /尚未实现/);
      const html = render({ status: "error", message });
      assert.match(html, /暂时无法加载售后工单/);
      assert.doesNotMatch(html, /<article|本次返回 \d+ 条工单|工单列表来源：/);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test("重新查询可更新状态、责任服务方和来源，失败后重试可恢复或清空列表", async (t) => {
  const responses = [
    Response.json(payload()),
    Response.json({ ok: false, error: { code: "UNAVAILABLE", message: "不可用" } }, { status: 503 }),
    Response.json(payload([{ ...ticket, status: "resolved", responsibleProviderId: null }], "live")),
    Response.json(payload([], "live")),
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.match(render({ status: "ready", response: await loadAdminTickets() }), /已分派/);
  await assert.rejects(loadAdminTickets());
  const updated = render({ status: "ready", response: await loadAdminTickets() });
  for (const text of ["已解决", "暂未指定责任服务方", "工单列表来源：已保存记录"]) assert.ok(updated.includes(text), text);
  assert.doesNotMatch(updated, /C-provider-test/);
  assert.match(render({ status: "ready", response: await loadAdminTickets() }), /本次列表暂无工单/);
  assert.equal(fetchMock.mock.callCount(), 4);
});
