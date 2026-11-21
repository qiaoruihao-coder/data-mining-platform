import test from "node:test";
import assert from "node:assert/strict";
import type { ScheduleDTO } from "../src/contracts";
import {
  activeTasks,
  blockedTasks,
  dayRangeLabel,
  dependencyNames,
  detectIssues,
  doneDays,
  progressPercent,
  scheduleStatus,
  startableTasks,
  taskEndDay,
  taskStatusLabel,
  toGanttRows,
  totalDays,
} from "../src/features/a/schedule";

type Task = ScheduleDTO["tasks"][number];

function task(over: Partial<Task> & Pick<Task, "id" | "name">): Task {
  return {
    startDay: 0,
    durationDays: 1,
    dependsOn: [],
    responsibleProviderId: "provider-a",
    status: "pending",
    ...over,
  };
}

/** 与 mock-data 同构的三道工序：勘查(done) → 拆除(active) → 基层处理(pending) */
const base: ScheduleDTO = {
  demandId: "demo-demand",
  version: 1,
  tasks: [
    task({ id: "inspect", name: "现场勘查", startDay: 0, durationDays: 1, status: "done" }),
    task({
      id: "demolition",
      name: "拆除",
      startDay: 1,
      durationDays: 2,
      dependsOn: ["inspect"],
      status: "active",
    }),
    task({
      id: "repair",
      name: "基层处理",
      startDay: 3,
      durationDays: 3,
      dependsOn: ["demolition"],
      status: "pending",
    }),
  ],
};

test("总工期取所有工序结束日的最大值，单道工序的结束日等于开始日加持续天数", () => {
  assert.equal(taskEndDay(base.tasks[0]), 1);
  assert.equal(taskEndDay(base.tasks[2]), 6);
  assert.equal(totalDays(base), 6);
  assert.equal(totalDays({ ...base, tasks: [] }), 0);
});

test("进度按已完成工序的工期占比推算，不会超过 100%", () => {
  assert.equal(doneDays(base), 1);
  assert.equal(progressPercent(base), 17);
  assert.equal(progressPercent({ ...base, tasks: [] }), 0);

  const allDone: ScheduleDTO = {
    ...base,
    tasks: base.tasks.map((item) => ({ ...item, status: "done" as const })),
  };
  assert.equal(progressPercent(allDone), 100);
});

test("并行工序分别计入总工作量，不能在仍有待开工工序时提前显示 100%", () => {
  const parallel: ScheduleDTO = {
    ...base,
    tasks: [
      task({ id: "a", name: "A", durationDays: 5, status: "done" }),
      task({ id: "b", name: "B", durationDays: 5, status: "done" }),
      task({ id: "c", name: "C", durationDays: 5, status: "pending" }),
    ],
  };
  assert.equal(totalDays(parallel), 5);
  assert.equal(progressPercent(parallel), 67);
  assert.equal(progressPercent({ ...parallel, tasks: parallel.tasks.map(t => ({ ...t, status: "done" })) }), 100);
});

test("排期空档与延后开工不改变工序完成比例", () => {
  const gap: ScheduleDTO = {
    ...base,
    tasks: [
      task({ id: "a", name: "A", startDay: 10, durationDays: 2, status: "done" }),
      task({ id: "b", name: "B", startDay: 100, durationDays: 2 }),
    ],
  };
  assert.equal(totalDays(gap), 102);
  assert.equal(progressPercent(gap), 50);
  assert.equal(progressPercent({ ...gap, tasks: gap.tasks.map(t => ({ ...t, status: "done" })) }), 100);
});

test("仍有进行中/受阻/待开工工序时，舍入上限为 99%", () => {
  for (const status of ["active", "blocked", "pending"] as const) {
    assert.equal(progressPercent({ ...base, tasks: [
      task({ id: "a", name: "A", durationDays: 999, status: "done" }),
      task({ id: "b", name: "B", durationDays: 1, status }),
    ] }), 99);
  }
  assert.equal(progressPercent({ ...base, tasks: [task({ id: "a", name: "A", status: "active" })] }), 0);
});

test("整体状态区分全部完成、等待后续、进行中、受阻与未开工", () => {
  const label = (statuses: Task["status"][]) => scheduleStatus({
    ...base, tasks: statuses.map((status, i) => task({ id: String(i), name: String(i), status })),
  }).label;
  assert.equal(label([]), "暂无工序");
  assert.equal(label(["done", "done"]), "工序全部完成");
  assert.equal(label(["done", "pending"]), "等待后续工序");
  assert.equal(label(["pending"]), "未开工");
  assert.equal(label(["active", "pending"]), "施工中");
  assert.equal(label(["blocked", "active"]), "有工序受阻");
});

test("只持续一天的工序显示「第 N 天」，多天显示区间，不出现「第 1–1 天」", () => {
  assert.equal(dayRangeLabel(base.tasks[0]), "第 1 天");
  assert.equal(dayRangeLabel(base.tasks[1]), "第 2–3 天");
  assert.equal(dayRangeLabel(base.tasks[2]), "第 4–6 天");
});

test("进行中与受阻工序分别归类，状态有中文文案", () => {
  assert.deepEqual(
    activeTasks(base).map((item) => item.id),
    ["demolition"],
  );
  assert.equal(blockedTasks(base).length, 0);
  assert.equal(taskStatusLabel("pending"), "待开工");
  assert.equal(taskStatusLabel("blocked"), "受阻待处理");
  assert.ok(!taskStatusLabel("done").includes("done"), "英文枚举不能直接显示给业主");
});

test("可开工任务只包含「前置工序全部完成」的待开工工序", () => {
  // 基层处理依赖的拆除仍是 active，所以现在不能开工
  assert.deepEqual(startableTasks(base), []);

  const demolitionDone: ScheduleDTO = {
    ...base,
    tasks: base.tasks.map((item) =>
      item.id === "demolition" ? { ...item, status: "done" as const } : item,
    ),
  };
  assert.deepEqual(
    startableTasks(demolitionDone).map((item) => item.id),
    ["repair"],
  );
});

test("依赖名称找不到时如实标注，不静默丢弃", () => {
  const broken: ScheduleDTO = {
    ...base,
    tasks: [...base.tasks, task({ id: "t1", name: "贴砖", dependsOn: ["ghost", "inspect"] })],
  };
  assert.deepEqual(dependencyNames(broken, broken.tasks[3]), [
    "未知工序（ghost）",
    "现场勘查",
  ]);
});

test("空排期直接报「没有任何工序」，而不是返回一份看起来正常的空计划", () => {
  const issues = detectIssues({ ...base, tasks: [] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "no-tasks");
});

test("正常排期（依赖完整、无重叠、单一进行中）自检通过", () => {
  assert.deepEqual(detectIssues(base), []);
});

test("自检能抓出依赖不存在、依赖未完成就开工、排期重叠、多道工序同时进行", () => {
  const missing = detectIssues({
    ...base,
    tasks: [task({ id: "t1", name: "贴砖", dependsOn: ["ghost"] })],
  });
  assert.ok(missing.some((issue) => issue.code === "dep-missing"));

  const unfinished = detectIssues({
    ...base,
    tasks: [
      task({ id: "a", name: "拆除", status: "pending" }),
      task({ id: "b", name: "贴砖", startDay: 2, dependsOn: ["a"], status: "active" }),
    ],
  });
  assert.ok(unfinished.some((issue) => issue.code === "dep-unfinished"));

  const overlap = detectIssues({
    ...base,
    tasks: [
      task({ id: "a", name: "拆除", durationDays: 3, status: "done" }),
      task({ id: "b", name: "贴砖", startDay: 1, dependsOn: ["a"] }),
    ],
  });
  assert.ok(overlap.some((issue) => issue.code === "dep-overlap"));

  const multi = detectIssues({
    ...base,
    tasks: [
      task({ id: "a", name: "拆除", status: "active" }),
      task({ id: "b", name: "水电", status: "active" }),
    ],
  });
  assert.ok(multi.some((issue) => issue.code === "multi-active"));
});

test("甘特行带上区间文案与依赖名，组件不需要再算一遍", () => {
  const rows = toGanttRows(base);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], {
    id: "repair",
    name: "基层处理",
    startDay: 3,
    durationDays: 3,
    status: "pending",
    statusLabel: "待开工",
    rangeLabel: "第 4–6 天",
    deps: ["拆除"],
  });
});
