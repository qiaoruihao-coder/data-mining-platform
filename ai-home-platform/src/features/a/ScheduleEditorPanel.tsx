"use client";

import { useState } from "react";
import type { ScheduleCreateInputDTO, ScheduleDTO, ScheduleRevisionInputDTO } from "@/contracts";
import { Badge, Button, C, Card, Field, Note, SectionHead } from "./ui";
import {
  createSchedule,
  nextTaskId,
  parseScheduleCreateRows,
  parseScheduleRevisionRows,
  reviseSchedule,
  rowsFromSchedule,
  scheduleMutationError,
  type ScheduleEditorRow,
} from "./schedule-editor";

const EMPTY_ROW: ScheduleEditorRow = {
  id: "task-1", name: "需求确认", startDay: "0", durationDays: "1", dependsOn: "",
};

function editorTitle(mode: "create" | "revision") {
  return mode === "create" ? "创建初始排期" : "修订未开工排期";
}

export function ScheduleEditorPanel({
  demandId,
  mode,
  schedule,
  onSaved,
}: {
  demandId: string;
  mode: "create" | "revision";
  schedule?: ScheduleDTO;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<ScheduleEditorRow[]>(() => schedule ? rowsFromSchedule(schedule) : [EMPTY_ROW]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateRow(index: number, field: keyof ScheduleEditorRow, value: string) {
    setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setError(null);
    setSuccess(null);
  }

  function addRow() {
    setRows(current => [...current, { ...EMPTY_ROW, id: nextTaskId(current), name: "新工序" }]);
    setError(null);
  }

  function removeRow(index: number) {
    setRows(current => current.length <= 1 ? current : current.filter((_, rowIndex) => rowIndex !== index));
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const parsed = mode === "create"
      ? parseScheduleCreateRows(demandId, rows)
      : parseScheduleRevisionRows(demandId, schedule?.version ?? 0, rows);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const result = mode === "create"
        ? await createSchedule(parsed.input as ScheduleCreateInputDTO)
        : await reviseSchedule(parsed.input as ScheduleRevisionInputDTO);
      setSuccess(`${editorTitle(mode)}成功，版本 v${result.data.version}；来源：${result.source}。页面将重新读取最新排期。`);
      onSaved();
    } catch (cause) {
      setError(scheduleMutationError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <SectionHead title={editorTitle(mode)} aside={<Badge tone="accent">业主确认</Badge>} />
      <p className={`mb-3 ${C.pageSub}`}>
        {mode === "create"
          ? "为本人已发布或已签约需求填写第一版工序计划；保存后由接口生成 v1。"
          : `基于排期 v${schedule?.version ?? "?"} 修改工序；保存会追加新版本，不覆盖历史版本。`}
      </p>
      {error ? <Note tone="danger" title="排期未保存"><p>{error}</p></Note> : null}
      {success ? <Note tone="ok" title="排期已保存"><p>{success}</p></Note> : null}
      <form className="space-y-3" onSubmit={submit} noValidate>
        <div className="grid gap-3">
          {rows.map((row, index) => (
            <div key={`${row.id}-${index}`} className="rounded-control border border-line bg-canvas/50 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className={C.meta}>工序 {index + 1}</span>
                <Button type="button" variant="ghost" size="sm" disabled={saving || rows.length <= 1} onClick={() => removeRow(index)}>删除</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="工序编号"><input className={C.input} value={row.id} disabled={saving} onChange={event => updateRow(index, "id", event.target.value)} /></Field>
                <Field label="工序名称"><input className={C.input} value={row.name} disabled={saving} onChange={event => updateRow(index, "name", event.target.value)} /></Field>
                <Field label="开始天数" hint="0=第1天"><input className={C.input} inputMode="numeric" value={row.startDay} disabled={saving} onChange={event => updateRow(index, "startDay", event.target.value)} /></Field>
                <Field label="工期" hint="天"><input className={C.input} inputMode="numeric" value={row.durationDays} disabled={saving} onChange={event => updateRow(index, "durationDays", event.target.value)} /></Field>
              </div>
              <div className="mt-3">
                <Field label="前置工序编号" hint="多个编号用逗号分隔">
                  <input className={C.input} value={row.dependsOn} disabled={saving} placeholder="无前置工序请留空" onChange={event => updateRow(index, "dependsOn", event.target.value)} />
                </Field>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={addRow}>新增工序</Button>
          <Button type="submit" disabled={saving}>{saving ? "正在保存…" : "确认并保存排期"}</Button>
        </div>
      </form>
      <p className={`mt-3 ${C.meta}`}>保存结果以接口回执为准；HTTP 501、冲突或网络不确定时不会显示成功。</p>
    </Card>
  );
}
