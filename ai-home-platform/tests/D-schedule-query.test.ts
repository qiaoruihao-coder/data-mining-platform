import test from "node:test";
import assert from "node:assert/strict";
import { Schedule } from "../src/contracts";
import { GET } from "../src/app/api/schedule/route";
import { findSchedule, toScheduleDTO, type ScheduleDatabase } from "../src/lib/schedule";

const row = {
  demandId: "demand-live",
  version: 1,
  tasksJson: JSON.stringify([{ id: "inspect", name: "勘查", startDay: 0, durationDays: 1, dependsOn: [], responsibleProviderId: null, status: "pending" }]),
};

function fakeDb(rows: typeof row[]): ScheduleDatabase {
  return {
    schedule: {
      findFirst: async () => rows[rows.length - 1] as never ?? null,
      findUnique: async ({ where }: { where: { demandId_version: { demandId: string; version: number } } }) =>
        rows.find((item) => item.demandId === where.demandId_version.demandId && item.version === where.demandId_version.version) as never ?? null,
    },
  } as unknown as ScheduleDatabase;
}

test("排期服务默认读取最新版本，真实需求来源为 live", async () => {
  const latest = { ...row, version: 2 };
  const result = await findSchedule({ demandId: row.demandId }, fakeDb([row, latest]));
  assert.deepEqual(result, { data: Schedule.parse({ demandId: row.demandId, version: 2, tasks: JSON.parse(row.tasksJson) }), source: "live" });
});

test("排期服务可以精确读取指定版本，演示需求来源保持 mock", async () => {
  const demo = { ...row, demandId: "demo-demand", version: 3 };
  const result = await findSchedule({ demandId: demo.demandId, version: 3 }, fakeDb([demo]));
  assert.equal(result?.data.version, 3);
  assert.equal(result?.source, "mock");
});

test("坏排期 JSON 或字段不符合公共契约时抛出数据错误", () => {
  assert.throws(() => toScheduleDTO({ ...row, tasksJson: "{" }), /排期数据格式无效/);
  assert.throws(() => toScheduleDTO({ ...row, tasksJson: "[{\"id\":\"x\"}]" }), /排期数据格式无效/);
});

test("排期路由保留无参数演示入口，并拒绝重复、空白和非法版本参数", async () => {
  const demo = await GET(new Request("http://localhost/api/schedule"));
  assert.equal(demo.status, 200);
  assert.deepEqual((await demo.json()).meta, { source: "mock" });

  for (const url of [
    "http://localhost/api/schedule?demandId=",
    "http://localhost/api/schedule?demandId=demand-live&demandId=other",
    "http://localhost/api/schedule?demandId=demand-live&version=0",
    "http://localhost/api/schedule?demandId=demand-live&version=abc",
  ]) {
    const response = await GET(new Request(url));
    assert.equal(response.status, 400);
    assert.deepEqual((await response.json()).error.code, "VALIDATION_ERROR");
  }
});
