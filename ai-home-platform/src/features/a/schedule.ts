/**
 * 施工进度的纯逻辑：工期统计、进度推算、可开工任务、排期自检。
 *
 * 为什么不在这里画图：这里只做计算，不引入 React 和网络，方便单测；
 * 页面（SchedulePanel）只负责把结果摆到界面上。
 *
 * 不造数原则：契约里 Schedule 没有真实日期字段（plannedStartDate / actualStart 等），
 * 所以本文件只按「相对天数」推算，并在页面上标明是推算值，不冒充真实日历日期。
 */
import type { ScheduleDTO } from "@/contracts";

export type ScheduleTaskDTO = ScheduleDTO["tasks"][number];
export type TaskStatus = ScheduleTaskDTO["status"];
export type Tone = "brand" | "accent" | "neutral" | "danger";

/** 契约里是英文枚举，界面上业主只看中文 */
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  pending: { label: "待开工", tone: "neutral" },
  active: { label: "进行中", tone: "brand" },
  done: { label: "已完成", tone: "neutral" },
  blocked: { label: "受阻待处理", tone: "danger" },
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS[status]?.label ?? status;
}

export function taskStatusTone(status: TaskStatus): Tone {
  return TASK_STATUS[status]?.tone ?? "neutral";
}

/** 任务的结束天（不含当天）：startDay=1、duration=2 → 结束于第 3 天开头 */
export function taskEndDay(task: ScheduleTaskDTO): number {
  const end = task.startDay + task.durationDays;
  return Number.isFinite(end) && end > 0 ? end : 0;
}

/** 总工期 = 所有任务结束天的最大值；空计划返回 0，避免除零和显示「第 0 天」 */
export function totalDays(schedule: ScheduleDTO): number {
  return schedule.tasks.reduce((max, task) => Math.max(max, taskEndDay(task)), 0);
}

/** 已完成任务的计划时长合计（天），用作进度分子；不是已流逝的日历天数。 */
export function doneDays(schedule: ScheduleDTO): number {
  return schedule.tasks
    .filter((task) => task.status === "done")
    .reduce((sum, task) => sum + task.durationDays, 0);
}

/** 按工序计划时长加权：并行工序分别计入分母，排期空档不算工作量。 */
export function progressPercent(schedule: ScheduleDTO): number {
  const total = schedule.tasks.reduce((sum, task) => sum + task.durationDays, 0);
  if (total <= 0) return 0;
  if (schedule.tasks.every((task) => task.status === "done")) return 100;
  const percent = Math.round((doneDays(schedule) / total) * 100);
  // 四舍五入也不能把尚未完成的计划显示成 100%。
  return Math.min(99, Math.max(0, percent));
}

export function scheduleStatus(schedule: ScheduleDTO): { label: string; tone: Tone } {
  if (schedule.tasks.length === 0) return { label: "暂无工序", tone: "neutral" };
  if (schedule.tasks.every((task) => task.status === "done")) return { label: "工序全部完成", tone: "brand" };
  if (schedule.tasks.some((task) => task.status === "blocked")) return { label: "有工序受阻", tone: "danger" };
  if (schedule.tasks.some((task) => task.status === "active")) return { label: "施工中", tone: "brand" };
  if (schedule.tasks.some((task) => task.status === "done")) return { label: "等待后续工序", tone: "neutral" };
  return { label: "未开工", tone: "neutral" };
}

/** 「第 1 天」或「第 1–3 天」，duration=1 时不显示区间，避免出现「第 1–1 天」 */
export function dayRangeLabel(task: ScheduleTaskDTO): string {
  const start = task.startDay + 1;
  if (task.durationDays <= 1) return `第 ${start} 天`;
  return `第 ${start}–${task.startDay + task.durationDays} 天`;
}

export function activeTasks(schedule: ScheduleDTO): ScheduleTaskDTO[] {
  return schedule.tasks.filter((task) => task.status === "active");
}

export function blockedTasks(schedule: ScheduleDTO): ScheduleTaskDTO[] {
  return schedule.tasks.filter((task) => task.status === "blocked");
}

/** 依赖名称：找不到的依赖如实标注「未知工序（id）」，不静默丢掉 */
export function dependencyNames(schedule: ScheduleDTO, task: ScheduleTaskDTO): string[] {
  return task.dependsOn.map((id) => {
    const dep = schedule.tasks.find((item) => item.id === id);
    return dep ? dep.name : `未知工序（${id}）`;
  });
}

/** 现在就能开工的任务：待开工，且所有依赖都已完成的，按计划开始日排序 */
export function startableTasks(schedule: ScheduleDTO): ScheduleTaskDTO[] {
  return schedule.tasks
    .filter((task) => task.status === "pending")
    .filter((task) =>
      task.dependsOn.every((id) => schedule.tasks.find((item) => item.id === id)?.status === "done"),
    )
    .sort((a, b) => a.startDay - b.startDay || a.name.localeCompare(b.name, "zh-CN"));
}

export type ScheduleIssue = {
  code: "no-tasks" | "dep-missing" | "dep-unfinished" | "dep-overlap" | "multi-active";
  message: string;
  taskIds: string[];
};

/**
 * 排期自检：把「业主看不懂 / 计划本身自相矛盾」的情况挑出来。
 * 这些是真实排期里最常吵架的三类问题：依赖不存在、依赖没做完就排了后道工序、同时多道工序在进行。
 */
export function detectIssues(schedule: ScheduleDTO): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (schedule.tasks.length === 0) {
    return [{ code: "no-tasks", message: "排期里没有任何工序，无法展示施工进度。", taskIds: [] }];
  }

  for (const task of schedule.tasks) {
    const missing = task.dependsOn.filter((id) => !schedule.tasks.some((item) => item.id === id));
    if (missing.length > 0) {
      issues.push({
        code: "dep-missing",
        message: `「${task.name}」依赖的工序不存在：${missing.join("、")}`,
        taskIds: [task.id],
      });
    }
  }

  for (const task of schedule.tasks) {
    if (task.status === "pending") continue;
    const unfinished = task.dependsOn
      .map((id) => schedule.tasks.find((item) => item.id === id))
      .filter((dep): dep is ScheduleTaskDTO => Boolean(dep) && dep!.status !== "done");
    if (unfinished.length > 0) {
      issues.push({
        code: "dep-unfinished",
        message: `「${task.name}」已${
          task.status === "done" ? "完工" : "开工"
        }，但前序工序「${unfinished.map((dep) => dep.name).join("、")}」还没完成。`,
        taskIds: [task.id, ...unfinished.map((dep) => dep.id)],
      });
    }
  }

  for (const task of schedule.tasks) {
    const overlapped = task.dependsOn
      .map((id) => schedule.tasks.find((item) => item.id === id))
      .filter((dep): dep is ScheduleTaskDTO => Boolean(dep) && taskEndDay(dep!) > task.startDay);
    if (overlapped.length > 0) {
      issues.push({
        code: "dep-overlap",
        message: `「${task.name}」从第 ${task.startDay + 1} 天开始，但前序工序「${overlapped
          .map((dep) => dep.name)
          .join("、")}」要到第 ${Math.max(...overlapped.map(taskEndDay))} 天才做完。`,
        taskIds: [task.id, ...overlapped.map((dep) => dep.id)],
      });
    }
  }

  const running = activeTasks(schedule);
  if (running.length > 1) {
    issues.push({
      code: "multi-active",
      message: `同时有 ${running.length} 道工序标为进行中：${running
        .map((task) => task.name)
        .join("、")}。业主需要明确当前主业是哪一道。`,
      taskIds: running.map((task) => task.id),
    });
  }

  return issues;
}

export type GanttRow = {
  id: string;
  name: string;
  startDay: number;
  durationDays: number;
  status: TaskStatus;
  statusLabel: string;
  rangeLabel: string;
  deps: string[];
};

/** 把契约数据转成甘特图需要的展示行，避免组件里再算一遍 */
export function toGanttRows(schedule: ScheduleDTO): GanttRow[] {
  return schedule.tasks.map((task) => ({
    id: task.id,
    name: task.name,
    startDay: task.startDay,
    durationDays: task.durationDays,
    status: task.status,
    statusLabel: taskStatusLabel(task.status),
    rangeLabel: dayRangeLabel(task),
    deps: dependencyNames(schedule, task),
  }));
}
