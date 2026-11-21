import test from "node:test";
import assert from "node:assert/strict";
import { Demand, DemandInput, Source, envelope } from "../src/contracts";
import { DEMO_DEMAND_ID, demandItemSource, toDemandDTO } from "../src/lib/demand";

const baseRow = {
  id: "demand-live",
  description: "浴室防滑改造",
  city: "深圳",
  areaM2: 60,
  budgetMinCents: 3000000,
  budgetMaxCents: 5000000,
  renovationType: "elderly" as const,
  desiredDays: 30,
  status: "published" as const,
};

test("公共 Demand 输出可选逐条 source，并拒绝未知来源", () => {
  assert.equal(Demand.parse({ ...baseRow, source: "live" }).source, "live");
  assert.equal(Demand.parse({ ...baseRow }).source, undefined);
  assert.equal(Demand.safeParse({ ...baseRow, source: "unknown" }).success, false);
  assert.equal(Source.safeParse("mock").success, true);
  assert.equal(Source.safeParse("other").success, false);
});

test("逐条 source 不成为创建/更新输入字段", () => {
  const input = { ...baseRow, id: undefined, status: undefined, source: "live" };
  assert.equal(DemandInput.safeParse(input).success, false);
});

test("需求服务为演示需求和数据库需求分别填入 mock/live", () => {
  assert.equal(demandItemSource(DEMO_DEMAND_ID), "mock");
  assert.equal(demandItemSource("demand-live"), "live");
  assert.equal(toDemandDTO(baseRow).source, "live");
  assert.equal(toDemandDTO({ ...baseRow, id: DEMO_DEMAND_ID }).source, "mock");
});

test("逐条 source 与整体 envelope source 可同时校验", () => {
  const data = Demand.parse({ ...baseRow, source: "live" });
  assert.equal(envelope(Demand).safeParse({ ok: true, data, meta: { source: "live" } }).success, true);
  assert.equal(envelope(Demand).safeParse({ ok: true, data, meta: { source: "unknown" } }).success, false);
});
