"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ChatResultDTO } from "@/contracts";
import {
  RENOVATION_OPTIONS,
  demandPath,
  fieldLabel,
  formFromDraft,
  formToInput,
  submitDemand,
  renovationLabel,
  sourceLabel,
  type DemandForm,
  type EnvelopeSource,
  type SubmitOutcome,
} from "./demand-chat";
import { Badge, Button, C, Card, Field, Note, SectionHead } from "./ui";

type Props = {
  result: ChatResultDTO | null;
  source: EnvelopeSource | null;
  onSubmittingChange: (submitting: boolean) => void;
};

/** 已填字段数 / 必填字段数，用于给业主一个「还差多少」的直观进度 */
function filledCount(form: DemandForm): number {
  const values = [
    form.description,
    form.city,
    form.areaM2,
    form.budgetMinYuan,
    form.budgetMaxYuan,
    form.desiredDays,
  ];
  return values.filter((value) => value.trim().length > 0).length;
}

/**
 * 结构化需求单：展示对话产出的草稿，允许人工修正后确认提交。
 * 草稿来源明确标注；提交失败时只显示真实失败状态，不制造成功态。
 */
export function DemandDraftPanel({ result, source, onSubmittingChange }: Props) {
  const draft = result?.draft ?? null;
  const [form, setForm] = useState<DemandForm>(() => formFromDraft(draft));
  const [manual, setManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const locked = useRef(false);
  const edited = useRef(false);

  useEffect(() => {
    if (draft && !locked.current && !edited.current) {
      setForm(formFromDraft(draft));
      setManual(false);
    }
  }, [draft]);

  const update = <K extends keyof DemandForm>(key: K, value: DemandForm[K]) => {
    if (locked.current) return;
    edited.current = true;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    if (locked.current) return;
    const checked = formToInput(form);
    if (!checked.ok) {
      setFormErrors(checked.messages);
      setOutcome(null);
      return;
    }
    setFormErrors([]);
    locked.current = true;
    setSubmitting(true);
    onSubmittingChange(true);
    setOutcome(null);
    try {
      const next = await submitDemand(form);
      locked.current = next.kind === "created";
      setOutcome(next);
    } finally {
      setSubmitting(false);
      onSubmittingChange(false);
    }
  };

  const created = outcome?.kind === "created" ? outcome.demand : null;
  const filled = filledCount(form);
  const showForm = Boolean(draft || manual);

  return (
    <Card>
      <SectionHead
        title="结构化需求单"
        aside={
          <Badge tone={draft ? "brand" : "neutral"}>
            {draft ? `草稿来源：${sourceLabel(source)}` : "尚无需求草稿"}
          </Badge>
        }
      />

      {result === null && (
        <p className={`!mb-0 ${C.meta}`}>
          可以在左侧描述需求，也可以直接手动填写；即使对话暂时不可用，也可填写需求单，核对后提交。
        </p>
      )}

      {result && result.missingFields.length > 0 && (
        <div className="mb-3">
          <Note tone="warn" title={source === "mock" ? "模拟追问示例" : `还缺这 ${result.missingFields.length} 项信息`}>
            {source === "mock" && (
              <p>当前为模拟问答，请手动填写需求单。</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {result.missingFields.map((field) => (
                <span
                  key={field}
                  className="rounded-tag bg-white/70 px-2 py-0.5 text-[13px] font-medium"
                >
                  {fieldLabel(field)}
                </span>
              ))}
            </div>
          </Note>
        </div>
      )}

      {result && result.ready && draft && (
        <div className="mb-3">
          <Note tone="ok">
            <p>请核对需求单，确认后提交。</p>
          </Note>
        </div>
      )}

      {!draft && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setManual((value) => !value)} disabled={submitting || Boolean(created)}>
            {manual ? "收起手动填写" : "手动填写需求单"}
          </Button>
          <span className={C.meta}>这部分内容由您填写，不是助手整理的结果。</span>
        </div>
      )}

      {showForm && (
        <fieldset className="grid min-w-0 gap-4" disabled={submitting || Boolean(created)} aria-label="结构化需求单" aria-busy={submitting}>
          <div className="flex items-center justify-between gap-2">
            <span className={C.sectionTitle}>需求信息</span>
            <span className={C.meta}>
              已填 <b className="num text-brand-hover">{filled}</b> / 6 项
            </span>
          </div>

          <Field label="需求描述" hint="必填">
            <textarea
              className={`min-h-[96px] resize-y ${C.input}`}
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="例如：老房适老化改造，卫生间加扶手、地面防滑、夜间照明"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="城市">
              <input
                className={C.input}
                value={form.city}
                onChange={(event) => update("city", event.target.value)}
                placeholder="例如：深圳"
              />
            </Field>
            <Field label="面积" hint="㎡">
              <input
                className={C.input}
                inputMode="decimal"
                value={form.areaM2}
                onChange={(event) => update("areaM2", event.target.value)}
                placeholder="例如：60"
              />
            </Field>
            <Field label="预算下限" hint="元">
              <input
                className={C.input}
                inputMode="decimal"
                value={form.budgetMinYuan}
                onChange={(event) => update("budgetMinYuan", event.target.value)}
                placeholder="例如：30000"
              />
            </Field>
            <Field label="预算上限" hint="元">
              <input
                className={C.input}
                inputMode="decimal"
                value={form.budgetMaxYuan}
                onChange={(event) => update("budgetMaxYuan", event.target.value)}
                placeholder="例如：50000"
              />
            </Field>
            <Field label="改造类型">
              <select
                className={C.input}
                value={form.renovationType}
                onChange={(event) =>
                  update("renovationType", event.target.value as DemandForm["renovationType"])
                }
              >
                {RENOVATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="期望工期" hint="天">
              <input
                className={C.input}
                inputMode="numeric"
                value={form.desiredDays}
                onChange={(event) => update("desiredDays", event.target.value)}
                placeholder="例如：30"
              />
            </Field>
          </div>

          <p className={`!mb-0 ${C.meta}`}>
            金额按「元」填写，最多两位小数，提交时准确换算为「分」；预算下限不能大于上限。当前类型：
            {renovationLabel(form.renovationType)}。
          </p>

          <div>
            <Button onClick={submit} disabled={submitting || Boolean(created)}>
              {submitting ? "提交中…" : created ? "需求已创建" : "确认并提交需求"}
            </Button>
          </div>
        </fieldset>
      )}

      {formErrors.length > 0 && (
        <div className="mt-3">
          <Note tone="danger" title="表单校验未通过">
            <ul className="list-disc pl-4">
              {formErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Note>
        </div>
      )}

      {outcome?.kind === "not_implemented" && (
        <div className="mt-3">
          <Note tone="info" title="暂时无法保存需求">
            <p>{outcome.message}</p>
            <p className={C.meta}>这次没有保存成功，也没有生成需求编号；请稍后重试。</p>
          </Note>
        </div>
      )}

      {outcome?.kind === "auth_required" && (
        <div className="mt-3">
          <Note tone="warn" title="请先完成业主登录">
            <p>{outcome.message}</p>
            <p className={C.meta}>登录后请回到本页继续提交；表单内容不会被清空。</p>
          </Note>
        </div>
      )}

      {outcome?.kind === "forbidden" && (
        <div className="mt-3">
          <Note tone="danger" title="当前没有需求创建权限">
            <p>{outcome.message}</p>
            <p className={C.meta}>请确认已使用业主账号登录；表单内容仍保留。</p>
          </Note>
        </div>
      )}

      {outcome?.kind === "rejected" && (
        <div className="mt-3">
          <Note tone="danger" title="接口拒绝了这份需求">
            <ul className="list-disc pl-4">
              {outcome.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Note>
        </div>
      )}

      {outcome?.kind === "failed" && (
        <div className="mt-3">
          <Note tone="danger">
            <p>提交失败：{outcome.message}</p>
            <p>保存结果未确认，请先到<Link href="/owner">需求列表</Link>核实，避免重复提交。</p>
          </Note>
        </div>
      )}

      {created && (
        <div className="mt-3">
          <Note tone="ok" title={`需求已创建（来源：${outcome?.kind === "created" ? sourceLabel(outcome.source) : "尚未确认"}）`}>
            <p>
              需求 ID：<code className="rounded-tag bg-white/70 px-1.5 py-0.5">{created.id}</code>
              <span className="ml-3">状态：{created.status}</span>
            </p>
            <p>
              <Link href={demandPath(created.id)} className="font-medium">
                打开需求详情
              </Link>
            </p>
            <p>已提交。新建需求请清空对话。</p>
          </Note>
        </div>
      )}
    </Card>
  );
}
