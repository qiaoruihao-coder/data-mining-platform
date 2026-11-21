import type { ScheduleDTO } from "@/contracts";
import { taskStatusLabel, type ScheduleTaskDTO } from "./schedule";

type FieldChange = { label: string; before: string; after: string };
export type ScheduleComparison =
  | { phase: "invalid"; error: string }
  | {
    phase: "ready";
    added: ScheduleTaskDTO[];
    removed: ScheduleTaskDTO[];
    changed: { task: ScheduleTaskDTO; fields: FieldChange[] }[];
  };

function dependencyLabel(task: ScheduleTaskDTO, schedule: ScheduleDTO): string {
  return task.dependsOn.map(id => {
    const dependency = schedule.tasks.find(item => item.id === id);
    return dependency ? `${dependency.name}（${id}）` : `未找到工序（${id}）`;
  }).join("、") || "无";
}

/** 对比已验证的公共 DTO；工序编号决定对应关系，不按名称猜测同一工序。 */
export function compareSchedules(selected: ScheduleDTO, latest: ScheduleDTO): ScheduleComparison {
  if (selected.demandId !== latest.demandId || latest.version < selected.version) {
    return { phase: "invalid", error: "两份排期的需求或版本不一致，请刷新后再比较。" };
  }
  for (const schedule of [selected, latest]) {
    if (new Set(schedule.tasks.map(task => task.id)).size !== schedule.tasks.length) {
      return { phase: "invalid", error: "排期中有重复的工序编号，暂时无法可靠对比。" };
    }
  }
  const before = new Map(selected.tasks.map(task => [task.id, task]));
  const after = new Map(latest.tasks.map(task => [task.id, task]));
  const result: Extract<ScheduleComparison, { phase: "ready" }> = {
    phase: "ready",
    added: latest.tasks.filter(task => !before.has(task.id)),
    removed: selected.tasks.filter(task => !after.has(task.id)),
    changed: [],
  };
  for (const task of latest.tasks) {
    const old = before.get(task.id);
    if (!old) continue;
    const fields: FieldChange[] = [];
    if (old.name !== task.name) fields.push({ label: "工序名称", before: old.name, after: task.name });
    if (old.startDay !== task.startDay) fields.push({ label: "计划开始", before: `第 ${old.startDay + 1} 天`, after: `第 ${task.startDay + 1} 天` });
    if (old.durationDays !== task.durationDays) fields.push({ label: "计划时长", before: `${old.durationDays} 天`, after: `${task.durationDays} 天` });
    // 依赖是关系集合，顺序改变不是排期变化；排序副本，保留传入 DTO。
    if (JSON.stringify([...old.dependsOn].sort()) !== JSON.stringify([...task.dependsOn].sort())) {
      fields.push({ label: "前置工序", before: dependencyLabel(old, selected), after: dependencyLabel(task, latest) });
    }
    if (old.responsibleProviderId !== task.responsibleProviderId) {
      fields.push({ label: "责任服务方编号", before: old.responsibleProviderId ?? "未指定", after: task.responsibleProviderId ?? "未指定" });
    }
    if (old.status !== task.status) fields.push({ label: "工序状态", before: taskStatusLabel(old.status), after: taskStatusLabel(task.status) });
    if (fields.length) result.changed.push({ task, fields });
  }
  if (selected.version === latest.version && (result.added.length || result.removed.length || result.changed.length)) {
    return { phase: "invalid", error: "同一版本的两次读取内容不一致，请刷新后再比较。" };
  }
  return result;
}
