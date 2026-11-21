import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand, Ticket } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import { DemandDetailContent } from "../src/features/a/DemandDetailPanel";
import {
  categoryLabel, createTicket, formToTicketInput, isTicketAccessDenied, loadTickets, statusLabel, submitTicket,
  ticketErrorMessage,
} from "../src/features/a/ticket-create";

const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

const demand = Demand.parse({
  id: "A-ticket-demand", description: "墙面返潮", city: "深圳", areaM2: 70,
  budgetMinCents: 3500000, budgetMaxCents: 5200000, renovationType: "repair",
  desiredDays: 35, status: "published", source: "live",
});
const ticket = Ticket.parse({
  id: "ticket-a1", demandId: demand.id, description: "墙面出现潮湿", category: "quality",
  responsibleProviderId: null, status: "open",
});
const envelope = (data: unknown, source: "mock" | "live" = "live") => ({ ok: true as const, data, meta: { source } });

test("工单输入复用公共契约并只提交允许字段", () => {
  assert.deepEqual(formToTicketInput(demand.id, { description: "  墙面返潮  ", category: "quality" }), {
    demandId: demand.id, description: "墙面返潮", category: "quality",
  });
  assert.throws(() => formToTicketInput(demand.id, { description: "", category: "quality" }));
  assert.equal(categoryLabel("schedule"), "进度问题");
  assert.equal(statusLabel("resolved"), "已解决");
});

test("创建工单使用公共 POST 契约并保留 live 来源", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/ticket");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { demandId: demand.id, description: "墙面返潮", category: "quality" });
    return Response.json(envelope(ticket, "live"), { status: 201 });
  });
  assert.deepEqual(await createTicket(demand.id, { description: " 墙面返潮 ", category: "quality" }), { ticket, source: "live" });
  assert.equal(request.mock.callCount(), 1);
});

test("读取本人工单按 demandId 精确请求并拒绝错位数据", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, `/api/ticket?demandId=${encodeURIComponent(demand.id)}`);
    return Response.json(envelope([ticket]));
  });
  assert.deepEqual(await loadTickets(demand.id), { data: [ticket], source: "live" });
  assert.equal(request.mock.callCount(), 1);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json(envelope([{ ...ticket, demandId: "other" }])));
  await assert.rejects(loadTickets(demand.id), /其他需求/);
});

test("401 返回登录提示且不丢失表单语义，403/404/409 诚实分类", async (t) => {
  for (const [status, code, kind, expected] of [
    [401, "UNAUTHENTICATED", "auth_required", /业主登录/],
    [403, "FORBIDDEN", "forbidden", /权限/],
    [404, "DEMAND_NOT_FOUND", "not_found", /未找到/],
    [409, "INVALID_STATE", "conflict", /状态/],
  ] as const) {
    const request = t.mock.method(globalThis, "fetch", async (_path: string) => Response.json(
      { ok: false, error: { code, message: "测试失败" } }, { status },
    ));
    const result = await submitTicket(demand.id, { description: "已填写的问题", category: "quality" });
    assert.equal(result.kind, kind);
    assert.match(result.message, expected);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("工单列表权限失败时隐藏面板，其他失败仍可显示重试提示", async () => {
  for (const status of [401, 403, 404]) {
    assert.equal(isTicketAccessDenied(new ApiClientError("denied", "DENIED", status)), true);
  }
  assert.equal(isTicketAccessDenied(new ApiClientError("unavailable", "UNAVAILABLE", 503)), false);
  assert.equal(isTicketAccessDenied(new Error("network")), false);
});

test("503 后先 GET 核实，不自动重复 POST", async (t) => {
  const calls: string[] = [];
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "POST") return Response.json({ ok: false, error: { code: "TICKET_UNAVAILABLE", message: "暂不可用" } }, { status: 503 });
    return Response.json(envelope([ticket], "live"));
  });
  const result = await submitTicket(demand.id, { description: "已填写的问题", category: "quality" });
  assert.equal(result.kind, "uncertain");
  if (result.kind === "uncertain") assert.deepEqual(result.tickets, { data: [ticket], source: "live" });
  assert.deepEqual(calls, ["POST /api/ticket", `GET /api/ticket?demandId=${encodeURIComponent(demand.id)}`]);
  assert.equal(request.mock.callCount(), 2);
});

test("详情页不会在本人权限预检完成前静态渲染可写工单表单", () => {
  const render = (item: typeof demand) => renderToStaticMarkup(createElement(DemandDetailContent, {
    id: item.id, state: { phase: "ready", demand: item, source: "live" }, reload() {},
  }));
  assert.doesNotMatch(render(demand), /提交售后工单/);
  assert.doesNotMatch(render({ ...demand, source: "mock" }), /提交售后工单/);
  assert.doesNotMatch(render({ ...demand, status: "draft" }), /提交售后工单/);
  assert.match(ticketErrorMessage(new Error("x")), /暂时不可用/);
});
