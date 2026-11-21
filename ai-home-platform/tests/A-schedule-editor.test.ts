import assert from "node:assert/strict";
import test from "node:test";
import { ApiClientError } from "../src/lib/api-client";
import {
  createSchedule,
  canReviseSchedule,
  parseScheduleCreateRows,
  parseScheduleRevisionRows,
  reviseSchedule,
  rowsFromSchedule,
  scheduleMutationError,
  type ScheduleEditorRow,
} from "../src/features/a/schedule-editor";
import { Schedule } from "../src/contracts";

const rows: ScheduleEditorRow[] = [
  { id: "task-1", name: "需求确认", startDay: "0", durationDays: "1", dependsOn: "" },
  { id: "task-2", name: "方案设计", startDay: "1", durationDays: "3", dependsOn: "task-1" },
];

const schedule = Schedule.parse({
  demandId: "demand-a", version: 4,
  tasks: rows.map((row) => ({
    id: row.id, name: row.name, startDay: Number(row.startDay), durationDays: Number(row.durationDays),
    dependsOn: row.dependsOn ? row.dependsOn.split(",") : [], responsibleProviderId: null, status: "pending",
  })),
});

const envelope = (data: unknown, source: "mock" | "live" = "live") => ({ ok: true as const, data, meta: { source } });

test("排期编辑行转换为公共创建契约并规范化文本", () => {
  const parsed = parseScheduleCreateRows(" demand-a ", [
    { ...rows[0], id: " task-1 ", name: " 需求确认 ", dependsOn: "  " },
    { ...rows[1], dependsOn: " task-1, task-1 " },
  ]);
  assert.equal(parsed.ok, false);

  const valid = parseScheduleCreateRows(" demand-a ", rows);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.input, {
      demandId: "demand-a",
      tasks: [
        { id: "task-1", name: "需求确认", startDay: 0, durationDays: 1, dependsOn: [] },
        { id: "task-2", name: "方案设计", startDay: 1, durationDays: 3, dependsOn: ["task-1"] },
      ],
    });
  }
});

test("创建和修订表单拒绝重复编号、负数、缺失依赖和时间冲突", () => {
  const invalidRows = [
    [{ ...rows[0] }, { ...rows[1], id: "task-1" }],
    [{ ...rows[0], startDay: "-1" }, rows[1]],
    [{ ...rows[0], id: "task-1" }, { ...rows[1], dependsOn: "missing" }],
    [{ ...rows[0] }, { ...rows[1], startDay: "0" }],
  ] as const;
  for (const candidate of invalidRows) {
    const result = parseScheduleCreateRows("demand-a", candidate as unknown as ScheduleEditorRow[]);
    assert.equal(result.ok, false);
  }
});

test("修订输入包含基准版本和确认标记，来源行可从公共排期还原", () => {
  assert.deepEqual(rowsFromSchedule(schedule), rows);
  assert.equal(canReviseSchedule(schedule), true);
  assert.equal(canReviseSchedule({ ...schedule, tasks: [{ ...schedule.tasks[0], status: "active" }] }), false);
  assert.equal(canReviseSchedule({ ...schedule, tasks: [{ ...schedule.tasks[0], responsibleProviderId: "provider-1" }] }), false);
  const parsed = parseScheduleRevisionRows("demand-a", 4, rows);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.input.demandId, "demand-a");
    assert.equal(parsed.input.baseVersion, 4);
    assert.equal(parsed.input.confirmed, true);
  }
});

test("创建和修订调用现有接口并保留逐条来源", async (t) => {
  let call = 0;
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/schedule");
    assert.equal(init?.method, call++ === 0 ? "POST" : "PUT");
    return Response.json(envelope(schedule, "live"), { status: 200 });
  });
  const createInput = parseScheduleCreateRows("demand-a", rows);
  assert.equal(createInput.ok, true);
  if (!createInput.ok) return;
  const created = await createSchedule(createInput.input);
  assert.deepEqual(created, { data: schedule, source: "live" });
  const revisionInput = parseScheduleRevisionRows("demand-a", 4, rows);
  assert.equal(revisionInput.ok, true);
  if (!revisionInput.ok) return;
  const revised = await reviseSchedule(revisionInput.input);
  assert.deepEqual(revised, { data: schedule, source: "live" });
  assert.equal(request.mock.callCount(), 2);
});

test("501、冲突、服务不可用和网络错误都不显示成功", () => {
  assert.match(scheduleMutationError(new ApiClientError("not implemented", "NOT_IMPLEMENTED", 501)), /501/);
  assert.match(scheduleMutationError(new ApiClientError("冲突", "CONFLICT", 409)), /重新读取最新排期/);
  assert.match(scheduleMutationError(new ApiClientError("不可用", "UNAVAILABLE", 503)), /无法确认/);
  assert.match(scheduleMutationError(new Error("offline")), /网络/);
});
