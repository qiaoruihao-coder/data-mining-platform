"use client";

import type { ScheduleDTO, SourceDTO } from "@/contracts";
import { useSchedule, type ScheduleState } from "./useSchedule";
import { compareSchedules } from "./schedule-comparison";
import { dayRangeLabel, taskStatusLabel, type ScheduleTaskDTO } from "./schedule";
import { Badge, Button, Card, Note, SectionHead } from "./ui";

export function ScheduleComparison({ selected, source }: { selected: ScheduleDTO; source: SourceDTO }) {
  const { reload, ...latest } = useSchedule(selected.demandId);
  return <ScheduleComparisonPanel selected={selected} source={source} latest={latest} onReload={reload} />;
}

function SourceLabel({ source }: { source: SourceDTO }) {
  return <Badge tone={source === "mock" ? "accent" : "brand"}>{source === "mock" ? "模拟数据" : "实际排期"}</Badge>;
}

function TaskSummary({ task }: { task: ScheduleTaskDTO }) {
  return <li className="break-words rounded-control border border-line p-4">
    <p className="font-medium text-ink">{task.name}（{task.id}）</p>
    <p className="num text-[15px] text-ink-2">{dayRangeLabel(task)}，{task.durationDays} 天，{taskStatusLabel(task.status)}</p>
  </li>;
}

export function ScheduleComparisonPanel({ selected, source, latest, onReload }: {
  selected: ScheduleDTO;
  source: SourceDTO;
  latest: ScheduleState;
  onReload: () => void;
}) {
  const result = latest.phase === "ready" && latest.data && latest.source
    ? compareSchedules(selected, latest.data)
    : null;
  return <Card className="mb-4">
    <SectionHead title="排期版本对比" aside={<Badge tone="neutral">只读对比</Badge>} />
    <p className="mb-3 text-[15px] text-ink-2">所选版本 v{selected.version} <SourceLabel source={source} /></p>
    {latest.phase === "loading" ? <Note tone="info">正在读取最新排期用于对比。正在加载，模拟记录会单独标注。</Note>
      : latest.phase === "missing" ? <Note tone="warn">未找到可用于对比的最新排期，请刷新核实。</Note>
        : latest.phase === "failed" || !result || !latest.data || !latest.source ? <Note tone="danger">最新排期读取失败，暂时无法对比；请确认业主登录状态后重试。</Note>
          : result.phase === "invalid" ? <Note tone="danger">{result.error}</Note>
            : <>
              <p className="mb-3 text-[15px] text-ink-2">本次读取的最新版本 v{latest.data.version} <SourceLabel source={latest.source} /></p>
              <p className="mb-3 text-[15px] text-ink-2">以下对比所选版本与最新排期。天数为计划值，不是实际日期。</p>
              {result.added.length + result.removed.length + result.changed.length === 0
                ? <Note tone="info">{selected.version === latest.data.version ? "所选版本已是本次读取的最新版本，工序内容一致。" : "两版工序内容一致，没有新增、移除或字段变化。"}</Note>
                : <>
                  <p className="mb-3 text-[15px] font-medium text-ink" role="status">新增 {result.added.length} 项 · 移除 {result.removed.length} 项 · 修改 {result.changed.length} 项</p>
                  {result.added.length > 0 ? <section className="mb-4" aria-label="新增工序">
                    <h3 className="mb-2 font-medium text-ink">新增工序</h3>
                    <ul className="grid gap-2">{result.added.map(task => <TaskSummary key={task.id} task={task} />)}</ul>
                  </section> : null}
                  {result.removed.length > 0 ? <section className="mb-4" aria-label="移除工序">
                    <h3 className="mb-2 font-medium text-ink">移除工序</h3>
                    <ul className="grid gap-2">{result.removed.map(task => <TaskSummary key={task.id} task={task} />)}</ul>
                  </section> : null}
                  {result.changed.map(({ task, fields }) => <section key={task.id} className="mb-4 break-words rounded-control border border-line p-4">
                    <h3 className="mb-2 font-medium text-ink">修改工序：{task.name}（{task.id}）</h3>
                    <dl className="grid gap-3">{fields.map(field => <div key={field.label}>
                      <dt className="text-[14px] font-medium text-ink">{field.label}</dt>
                      <dd className="grid gap-1 text-[14px] text-ink-2 sm:grid-cols-2">
                        <span>所选版本：{field.before}</span><span>最新版本：{field.after}</span>
                      </dd>
                    </div>)}</dl>
                  </section>)}
                </>}
            </>}
    <div className="mt-3"><Button variant="secondary" size="sm" onClick={onReload} disabled={latest.phase === "loading"}>刷新对比</Button></div>
  </Card>;
}
