import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Demand } from "../src/contracts";
import { DemandEditPanel } from "../src/features/a/DemandEditPanel";
import {
  demandCanMutate,
  demandFormFromDetail,
  deleteDemand,
  updateDemand,
} from "../src/features/a/demand-detail-edit";

const demand = Demand.parse({
  id: "d-1",
  description: "卫生间防滑改造",
  city: "深圳",
  areaM2: 70,
  budgetMinCents: 3500000,
  budgetMaxCents: 5200000,
  renovationType: "elderly",
  desiredDays: 35,
  status: "published",
  source: "live",
});

const form = demandFormFromDetail(demand);
const ok = (data: unknown, source = "live") => ({ ok: true, data, meta: { source } });

const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

test("详情编辑只允许未签约真实需求，表单映射复用公共字段", () => {
  assert.equal(demandCanMutate(demand), true);
  assert.equal(demandFormFromDetail(demand).budgetMinYuan, "35000");
  assert.equal(demandFormFromDetail(demand).budgetMaxYuan, "52000");
  assert.equal(demandCanMutate({ ...demand, id: "demo-demand" }), false);
  assert.equal(demandCanMutate({ ...demand, status: "contracted" }), false);
});

test("详情编辑卡片按状态提供操作，演示需求保持只读", () => {
  const liveHtml = renderToStaticMarkup(createElement(DemandEditPanel, { demand, onChanged() {} }));
  assert.match(liveHtml, /编辑需求/);
  assert.match(liveHtml, /删除需求/);

  const demoHtml = renderToStaticMarkup(createElement(DemandEditPanel, {
    demand: { ...demand, id: "demo-demand", source: "mock" },
    onChanged() {},
  }));
  assert.match(demoHtml, /演示需求，不能修改或删除/);
  assert.doesNotMatch(demoHtml, /编辑需求/);
  assert.doesNotMatch(demoHtml, /删除需求/);
});

test("更新发送完整 DemandInput，校验成功响应的 ID 和逐条来源", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/demand/d-1");
    assert.equal(init?.method, "PUT");
    assert.equal(init?.headers && new Headers(init.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      description: "卫生间防滑改造",
      city: "深圳",
      areaM2: 70,
      budgetMinCents: 3500000,
      budgetMaxCents: 5200000,
      renovationType: "elderly",
      desiredDays: 35,
    });
    return Response.json(ok(demand, "live"));
  });
  assert.deepEqual(await updateDemand("d-1", form), { kind: "updated", demand, source: "live" });
  assert.equal(request.mock.callCount(), 1);
});

test("非法编辑表单不发请求；响应错位或缺来源不产生成功态", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json(ok({ ...demand, id: "other" })));
  const invalid = await updateDemand("d-1", { ...form, budgetMinYuan: "52001", budgetMaxYuan: "52000" });
  assert.equal(invalid.kind, "rejected");
  assert.equal(request.mock.callCount(), 0);

  const mismatch = await updateDemand("d-1", form);
  assert.equal(mismatch.kind, "failed");
  assert.equal(request.mock.callCount(), 1);
  t.mock.restoreAll();

  const missingSource = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data: demand }));
  const failed = await updateDemand("d-1", form);
  assert.equal(failed.kind, "failed");
  assert.equal(missingSource.mock.callCount(), 1);
});

test("更新和删除的 501 均明确失败，不能把伪造成功信封当成成功", async (t) => {
  for (const [action, response] of [
    ["update", Response.json(ok(demand), { status: 501 })],
    ["delete", Response.json(ok({ id: "d-1", deleted: true }), { status: 501 })],
  ] as const) {
    const request = t.mock.method(globalThis, "fetch", async () => response);
    const result = action === "update" ? await updateDemand("d-1", form) : await deleteDemand("d-1");
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") assert.match(result.message, /尚未开放/);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("删除校验返回的 ID、deleted 和来源，并保留业务错误", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/demand/d-1");
    assert.equal(init?.method, "DELETE");
    assert.equal(init?.body, undefined);
    return Response.json(ok({ id: "d-1", deleted: true }, "live"));
  });
  assert.deepEqual(await deleteDemand("d-1"), { kind: "deleted", result: { id: "d-1", deleted: true }, source: "live" });
  assert.equal(request.mock.callCount(), 1);
  t.mock.restoreAll();

  const conflict = t.mock.method(globalThis, "fetch", async () => Response.json(
    { ok: false, error: { code: "DEMAND_HAS_RELATED_RECORDS", message: "存在关联记录" } },
    { status: 409 },
  ));
  const result = await deleteDemand("d-1");
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.match(result.message, /不允许修改/);
  assert.equal(conflict.mock.callCount(), 1);
});

test("两种操作均编码特殊需求 ID，保留 mock/live 信封来源", async (t) => {
  const id = "需求/a?x=1&#";
  for (const source of ["mock", "live"] as const) {
    const updated = { ...demand, id, source };
    const deleted = { id, deleted: true };
    const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, `/api/demand/${encodeURIComponent(id)}`);
      return Response.json(ok(init?.method === "PUT" ? updated : deleted, source));
    });
    assert.deepEqual(await updateDemand(id, form), { kind: "updated", demand: updated, source });
    assert.deepEqual(await deleteDemand(id), { kind: "deleted", result: deleted, source });
    assert.equal(request.mock.callCount(), 2);
    t.mock.restoreAll();
  }
});

test("更新和删除保留 HTTP 状态、业务错误码与对应提示，不自动重试", async (t) => {
  for (const [status, code, message] of [
    [400, "VALIDATION_ERROR", /HTTP 400/],
    [401, "UNAUTHENTICATED", /请先完成业主登录/],
    [403, "FORBIDDEN", /没有权限/],
    [404, "DEMAND_NOT_FOUND", /HTTP 404/],
    [409, "DEMAND_HAS_RELATED_RECORDS", /不允许修改/],
    [501, "NOT_IMPLEMENTED", /尚未开放/],
    [503, "SERVICE_UNAVAILABLE", /暂时不可用/],
  ] as const) {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json(
      { ok: false, error: { code, message: "测试错误" } }, { status },
    ));
    for (const result of [await updateDemand("d-1", form), await deleteDemand("d-1")]) {
      assert.equal(result.kind, "failed");
      if (result.kind === "failed") {
        assert.equal(result.status, status);
        assert.equal(result.code, code);
        assert.match(result.message, message);
      }
    }
    assert.equal(request.mock.callCount(), 2);
    t.mock.restoreAll();
  }
});

test("更新遇到 401 非 JSON 或伪造成功信封仍要求业主登录，不产生成功结果或重试", async (t) => {
  for (const [response, code] of [
    [new Response("not json", { status: 401 }), "INVALID_RESPONSE"],
    [Response.json(ok(demand), { status: 401 }), "HTTP_401"],
  ] as const) {
    const request = t.mock.method(globalThis, "fetch", async () => response);
    const editedForm = { ...form, description: "保留尚未保存的改造说明" };
    const originalForm = { ...editedForm };
    const result = await updateDemand("d-1", editedForm);
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.status, 401);
      assert.equal(result.code, code);
      assert.match(result.message, /请先完成业主登录/);
    }
    assert.deepEqual(editedForm, originalForm);
    assert.equal(request.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("删除错位 ID、deleted=false、缺少来源及 200 错误信封均被拒绝", async (t) => {
  for (const payload of [
    ok({ id: "other", deleted: true }), ok({ id: "d-1", deleted: false }),
    { ok: true, data: { id: "d-1", deleted: true } },
    { ok: false, error: { code: "TEST_ERROR", message: "测试失败" } },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    const result = await deleteDemand("d-1");
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") {
      assert.equal(result.code, "INVALID_RESPONSE");
      assert.equal(result.status, 200);
    }
    t.mock.restoreAll();
  }
});

test("两种操作的网络异常、非 JSON 与 501 非 JSON 均明确失败", async (t) => {
  for (const status of [0, 200, 501]) {
    const request = t.mock.method(globalThis, "fetch", async () => {
      if (status === 0) throw new Error("test offline");
      return new Response("not json", { status });
    });
    for (const result of [await updateDemand("d-1", form), await deleteDemand("d-1")]) {
      assert.equal(result.kind, "failed");
      if (result.kind === "failed") {
        assert.equal(result.status, status);
        assert.equal(result.code, status === 0 ? "NETWORK_ERROR" : "INVALID_RESPONSE");
        if (status === 0) assert.match(result.message, /网络请求失败/);
        if (status === 501) assert.match(result.message, /尚未开放/);
      }
    }
    assert.equal(request.mock.callCount(), 2);
    t.mock.restoreAll();
  }
});
