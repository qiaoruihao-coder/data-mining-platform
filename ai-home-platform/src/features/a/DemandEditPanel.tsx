"use client";

import { useState } from "react";
import type { DemandDTO } from "@/contracts";
import {
  demandCanMutate,
  demandFormFromDetail,
  deleteDemand,
  updateDemand,
  type DemandMutationOutcome,
} from "./demand-detail-edit";
import {
  RENOVATION_OPTIONS,
  type DemandForm,
} from "./demand-chat";
import { statusLabel } from "./demand-list";
import { Badge, Button, C, Card, Field, Note, SectionHead } from "./ui";

export function DemandEditPanel({ demand, onChanged }: { demand: DemandDTO; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DemandForm>(() => demandFormFromDetail(demand));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DemandMutationOutcome | null>(null);

  if (!demandCanMutate(demand)) {
    return (
      <Card>
        <SectionHead title="需求修改" aside={<Badge tone="neutral">当前只读</Badge>} />
        <p className={`!mb-0 ${C.meta}`}>
          {demand.id === "demo-demand"
            ? "这是演示需求，不能修改或删除。"
            : `当前状态为「${statusLabel(demand.status)}」，服务端不允许修改或删除。`}
        </p>
      </Card>
    );
  }

  const update = <K extends keyof DemandForm>(key: K, value: DemandForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setOutcome(null);
  };

  const save = async () => {
    setBusy(true);
    setOutcome(null);
    const next = await updateDemand(demand.id, form);
    setOutcome(next);
    setBusy(false);
    if (next.kind === "updated") {
      setEditing(false);
      onChanged();
    }
  };

  const remove = async () => {
    if (typeof window !== "undefined" && !window.confirm("确认删除这条需求吗？删除后无法恢复。")) return;
    setBusy(true);
    setOutcome(null);
    const next = await deleteDemand(demand.id);
    setOutcome(next);
    setBusy(false);
    if (next.kind === "deleted" && typeof window !== "undefined") window.location.assign("/owner");
  };

  return (
    <Card>
      <SectionHead title="需求修改" aside={<Badge tone="brand">可编辑</Badge>} />
      <p className={`!mb-3 ${C.meta}`}>
        仅允许修改尚未签约的需求；更新会完整替换下方字段，服务端会再次校验状态和数据。
      </p>

      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setForm(demandFormFromDetail(demand)); setOutcome(null); setEditing(true); }}>
            编辑需求
          </Button>
          <Button variant="danger" size="sm" onClick={() => void remove()} disabled={busy}>
            {busy ? "处理中…" : "删除需求"}
          </Button>
        </div>
      ) : (
        <fieldset className="grid gap-3" disabled={busy} aria-busy={busy} aria-label="编辑需求">
          <Field label="需求描述" hint="必填">
            <textarea className={`min-h-[88px] resize-y ${C.input}`} value={form.description} onChange={(event) => update("description", event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="城市" hint="必填">
              <input className={C.input} value={form.city} onChange={(event) => update("city", event.target.value)} />
            </Field>
            <Field label="面积" hint="㎡">
              <input className={C.input} inputMode="decimal" value={form.areaM2} onChange={(event) => update("areaM2", event.target.value)} />
            </Field>
            <Field label="预算下限" hint="元">
              <input className={C.input} inputMode="decimal" value={form.budgetMinYuan} onChange={(event) => update("budgetMinYuan", event.target.value)} />
            </Field>
            <Field label="预算上限" hint="元">
              <input className={C.input} inputMode="decimal" value={form.budgetMaxYuan} onChange={(event) => update("budgetMaxYuan", event.target.value)} />
            </Field>
            <Field label="改造类型">
              <select className={C.input} value={form.renovationType} onChange={(event) => update("renovationType", event.target.value as DemandForm["renovationType"])}>
                {RENOVATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="期望工期" hint="天">
              <input className={C.input} inputMode="numeric" value={form.desiredDays} onChange={(event) => update("desiredDays", event.target.value)} />
            </Field>
          </div>
          {outcome?.kind === "rejected" ? <Note tone="warn" title="请先修正表单">{outcome.messages.map((message) => <p key={message}>{message}</p>)}</Note> : null}
          {outcome?.kind === "failed" ? (
            <Note tone={outcome.status === 401 ? "warn" : "danger"} title={outcome.status === 401 ? "请先完成业主登录" : "操作失败"}>
              <p>{outcome.message}</p>
              {outcome.status === 401 ? <p>请先登录业主账号。已填内容保留。</p> : null}
            </Note>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>{busy ? "保存中…" : "保存修改"}</Button>
            <Button variant="secondary" onClick={() => { setEditing(false); setOutcome(null); }} disabled={busy}>取消</Button>
          </div>
        </fieldset>
      )}
      {outcome?.kind === "updated" ? <Note tone="ok"><p>已更新。</p></Note> : null}
      {outcome?.kind === "deleted" ? <Note tone="ok"><p>已删除，返回列表。</p></Note> : null}
    </Card>
  );
}
