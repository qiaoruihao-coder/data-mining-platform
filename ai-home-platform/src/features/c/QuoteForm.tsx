"use client";

import React, { useEffect, useRef, useState } from "react";
import type { DemandDTO, QuoteSubmissionInputDTO } from "@/contracts";
import { C } from "@/components/ui";
import {
  emptyQuoteLine, formatQuoteMoney, MAX_QUOTE_LINES, quoteSubmissionInput, quoteUnitLabels, validateQuoteForm,
  type QuoteFormFields, type QuoteFormResult, type QuoteLineFields, type QuotePreviewData,
} from "./quote-form";
import { quoteSubmissionFailure, quoteUncertainRetryFailure, submitQuote, type QuoteSubmissionState } from "./quote-submit";
import { createQuoteSubmissionSession } from "./quote-idempotency";
import { QuoteReceipt } from "./QuoteReceipt";

const inputClass = `${C.input} mt-1 block disabled:bg-mist`;
const buttonClass = `${C.btnBase} ${C.btnSecondary}`;
const primaryButtonClass = `${C.btnBase} ${C.btnPrimary}`;
const labelClass = `${C.labelText} text-[14px]`;

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? <p id={`quote-${field}-error`} className="!mb-0 mt-1 text-[14px] text-danger">{errors[field]}</p> : null;
}

export function QuotePreview({ preview }: { preview: QuotePreviewData }) {
  const pendingCount = preview.items.filter((item) => item.amountCents === null).length;
  return (
    <section aria-labelledby="quote-preview-title" className="num mt-6 rounded-card border border-brand/20 bg-brand-soft p-4 sm:p-6">
      <h3 id="quote-preview-title" className="!mb-0">报价预览 · 未提交</h3>
      <p className="mt-1 text-[14px] text-ink-2">尚未提交，业主暂不可见。</p>
      <p className="text-[15px]">预计工期：{preview.estimatedDays} 天</p>
      <ol aria-label="报价预览明细" className="space-y-3">
        {preview.items.map((item, index) => (
          <li key={item.code} className="min-w-0 break-words rounded-control border border-line bg-white p-4">
            <h4 className="break-words text-[16px] font-semibold">{index + 1}. {item.name}</h4>
            <p className="mb-1 mt-2 text-[14px] text-ink-2">
              {item.quantity} {quoteUnitLabels[item.unit]} × {item.unitPriceCents === null ? "单价待确认" : `${formatQuoteMoney(item.unitPriceCents)}/${quoteUnitLabels[item.unit]}`}
            </p>
            <p className="mb-1 font-medium">项目金额：{item.amountCents === null ? "待确认" : formatQuoteMoney(item.amountCents)}</p>
            {item.note && <p className="mb-0 whitespace-pre-wrap break-words text-[14px] text-ink-2">备注：{item.note}</p>}
          </li>
        ))}
      </ol>
      <p className="mb-1 mt-4 break-words text-[20px] font-semibold text-brand-hover">已知金额小计：{formatQuoteMoney(preview.knownTotalCents)}</p>
      <p className="text-[14px]">
        {pendingCount > 0
          ? `另有 ${pendingCount} 项费用待确认，未计入小计；当前无法确定完整总价。`
          : "单价已填齐，请核对后提交。"}
      </p>
      <p className={`!mb-0 ${C.meta}`}>预览按每行四舍五入到分后汇总，最终计价以接口规则为准；编辑任何字段后需重新预览。</p>
    </section>
  );
}

export function QuoteSubmissionFeedback({ state, onRetry }: { state: QuoteSubmissionState; onRetry?: () => void }) {
  if (state.status === "idle") return null;
  if (state.status === "submitting") return <p role="status">正在提交报价，请勿重复操作或离开页面…</p>;
  if (state.status === "rejected" || state.status === "uncertain") {
    return (
      <div role="alert" className={`${C.note} ${C.noteWarn} mt-4`}>
        <h3 className="!mb-1 text-[16px]">{state.status === "uncertain" ? "提交结果未知" : "报价未提交成功"}</h3>
        <p>{state.message}</p>
        <p className="!mb-0">填写内容仍保留在当前页面；刷新或离开页面会丢失。</p>
        {state.status === "uncertain" && state.retryable !== false && (
          <div className="mt-4">
            <button type="button" onClick={onRetry} disabled={!onRetry} className={buttonClass}>
              使用同一标识重试
            </button>
            <p className="mb-0 mt-2 text-[14px]">重试会复用本次提交标识和内容，不修改填写内容，也不会换键重发。</p>
          </div>
        )}
      </div>
    );
  }
  const { data, source } = state.response;
  return <QuoteReceipt quote={data} source={source} />;
}

export function QuoteForm({ demandId }: { demandId: DemandDTO["id"] }) {
  const [fields, setFields] = useState<QuoteFormFields>({ lines: [emptyQuoteLine(1)], estimatedDays: "" });
  const [result, setResult] = useState<QuoteFormResult | null>(null);
  const [submission, setSubmission] = useState<QuoteSubmissionState>({ status: "idle" });
  const [submissionSession] = useState(createQuoteSubmissionSession);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const nextLine = useRef(2);
  const errorSummary = useRef<HTMLDivElement>(null);
  const submissionFeedback = useRef<HTMLDivElement>(null);
  const errors = result?.kind === "invalid" ? result.errors : {};
  const locked = submission.status === "submitting" || submission.status === "received" || submission.status === "uncertain";
  const canSubmit = result?.kind === "preview" && !locked;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (result?.kind === "invalid") errorSummary.current?.focus();
  }, [result]);

  useEffect(() => {
    if (submission.status === "rejected" || submission.status === "uncertain" || submission.status === "received") submissionFeedback.current?.focus();
  }, [submission]);

  function change(update: (previous: QuoteFormFields) => QuoteFormFields) {
    if (inFlight.current || locked) return;
    submissionSession.invalidate();
    setFields(update);
    setResult(null);
    setSubmission({ status: "idle" });
  }

  async function attemptSubmit(allowUncertain: boolean) {
    if (inFlight.current || result?.kind !== "preview") return;
    if (allowUncertain ? submission.status !== "uncertain" : !canSubmit) return;
    let input: QuoteSubmissionInputDTO;
    try {
      input = quoteSubmissionInput(demandId, result.preview);
    } catch {
      setSubmission({ status: "rejected", message: "需求或报价填写有误，请检查后重新预览。尚未提交。" });
      return;
    }
    inFlight.current = true;
    setSubmission({ status: "submitting" });
    try {
      const attempt = submissionSession.prepare(input);
      const response = await submitQuote(attempt.input, attempt.idempotencyKey);
      if (mounted.current) setSubmission({ status: "received", response });
    } catch (error) {
      if (mounted.current) setSubmission(allowUncertain ? quoteUncertainRetryFailure(error) : quoteSubmissionFailure(error));
    } finally {
      inFlight.current = false;
    }
  }

  async function submit() {
    await attemptSubmit(false);
  }

  async function retry() {
    if (submission.status !== "uncertain" || submission.retryable === false) return;
    await attemptSubmit(true);
  }

  function updateLine(code: string, patch: Partial<Omit<QuoteLineFields, "code">>) {
    change((previous) => ({ ...previous, lines: previous.lines.map((line) => line.code === code ? { ...line, ...patch } : line) }));
  }

  function addLine() {
    if (fields.lines.length >= MAX_QUOTE_LINES) return;
    const line = emptyQuoteLine(nextLine.current++);
    change((previous) => ({ ...previous, lines: [...previous.lines, line] }));
  }

  function inputA11y(field: string) {
    return { id: `quote-${field}`, "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `quote-${field}-error` : undefined };
  }

  return (
    <section className={`${C.card} my-4`} aria-labelledby="quote-form-title">
      <h2 id="quote-form-title" className="!mb-1">填写报价</h2>
      <p className={`break-all ${C.meta}`}>关联需求：{demandId}</p>
      <div id="quote-local-notice" className={`${C.note} ${C.noteInfo} mb-6 [&>p]:!mb-2 [&>p:last-child]:!mb-0`}>
        <p>登录服务方后可提交报价，业主确认后才能接单。演示报价会标注为模拟。</p>
        <p>账号登录不等于资质认证。</p>
        <p className="mb-0">未提交的内容不会保存，刷新或离开页面会丢失。</p>
      </div>
      <form
        noValidate
        aria-label="报价填写"
        aria-describedby="quote-local-notice"
        aria-busy={submission.status === "submitting"}
        onSubmit={(event) => {
          event.preventDefault();
          if (inFlight.current || locked) return;
          setResult(validateQuoteForm(fields));
          setSubmission({ status: "idle" });
        }}
      >
        {result?.kind === "invalid" && (
          <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-4 rounded-control border border-danger/30 bg-danger-soft p-4 text-danger focus:outline focus:outline-2 focus:outline-danger">
            <p className="font-semibold">请修正以下填写问题，再生成预览：</p>
            <ul className="mb-0 list-inside list-disc text-[14px]">
              {Object.entries(errors).map(([field, message]) => (
                <li key={field}><a href={`#quote-${field}`} className="underline">{field.startsWith("line-") ? `项目 ${fields.lines.findIndex((line) => field.startsWith(`${line.code}-`)) + 1}：` : ""}{message}</a></li>
              ))}
            </ul>
          </div>
        )}
        <fieldset disabled={locked} className="min-w-0">
        <legend className="sr-only">报价明细与工期</legend>
        <div id="quote-lines" tabIndex={-1}>
          <p className={C.meta}>项目名称、单位、数量和预计工期必填。单价以元填写；未知费用请勾选待确认并注明原因。</p>
          {fields.lines.length === 0 && <p role="status">尚无报价项目，请添加至少一项。</p>}
          <FieldError field="lines" errors={errors} />
          {fields.lines.map((line, index) => (
            <fieldset key={line.code} className="mb-5 min-w-0 rounded-card border border-line p-4 sm:p-5">
              <legend className="px-2 text-[16px] font-semibold">报价项目 {index + 1}</legend>
              <div className="mb-3 flex justify-end">
                <button type="button" onClick={() => change((previous) => ({ ...previous, lines: previous.lines.filter((item) => item.code !== line.code) }))} aria-label={`删除报价项目 ${index + 1}`} className={buttonClass}>删除项目</button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor={`quote-${line.code}-name`} className={labelClass}>项目名称</label>
                  <input {...inputA11y(`${line.code}-name`)} className={inputClass} required maxLength={100} value={line.name} onChange={(event) => updateLine(line.code, { name: event.target.value })} />
                  <FieldError field={`${line.code}-name`} errors={errors} />
                </div>
                <div>
                  <label htmlFor={`quote-${line.code}-unit`} className={labelClass}>计价单位</label>
                  <select {...inputA11y(`${line.code}-unit`)} className={inputClass} value={line.unit} onChange={(event) => {
                    const unit = event.target.value;
                    if (unit === "m2" || unit === "piece" || unit === "job") updateLine(line.code, { unit });
                  }}>
                    {Object.entries(quoteUnitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <FieldError field={`${line.code}-unit`} errors={errors} />
                </div>
                <div>
                  <label htmlFor={`quote-${line.code}-quantity`} className={labelClass}>数量 · 最多三位小数，上限 1,000,000</label>
                  <input {...inputA11y(`${line.code}-quantity`)} className={inputClass} required inputMode="decimal" maxLength={32} value={line.quantity} onChange={(event) => updateLine(line.code, { quantity: event.target.value })} />
                  <FieldError field={`${line.code}-quantity`} errors={errors} />
                </div>
                <div>
                  <label htmlFor={`quote-${line.code}-priceYuan`} className={labelClass}>单价 / 元</label>
                  <input {...inputA11y(`${line.code}-priceYuan`)} className={inputClass} required={!line.pending} disabled={line.pending} inputMode="decimal" maxLength={32} value={line.priceYuan} onChange={(event) => updateLine(line.code, { priceYuan: event.target.value })} />
                  <FieldError field={`${line.code}-priceYuan`} errors={errors} />
                </div>
                <div className="flex items-center gap-2">
                  <input id={`quote-${line.code}-pending`} type="checkbox" className="h-4 w-4 accent-brand" checked={line.pending} onChange={(event) => updateLine(line.code, { pending: event.target.checked })} />
                  <label htmlFor={`quote-${line.code}-pending`} className="text-[14px] text-ink-2">费用待确认</label>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`quote-${line.code}-note`} className={labelClass}>备注{line.pending ? " · 请说明待确认原因" : " · 选填"}</label>
                  <textarea {...inputA11y(`${line.code}-note`)} className={inputClass} rows={2} required={line.pending} maxLength={1000} value={line.note} onChange={(event) => updateLine(line.code, { note: event.target.value })} />
                  <FieldError field={`${line.code}-note`} errors={errors} />
                </div>
              </div>
            </fieldset>
          ))}
        </div>
        <button type="button" className={buttonClass} disabled={fields.lines.length >= MAX_QUOTE_LINES} onClick={addLine}>添加报价项目</button>
        <span className={`num ml-3 ${C.meta}`}>{fields.lines.length}/{MAX_QUOTE_LINES} 项</span>
        <div className="my-6 max-w-sm">
          <label htmlFor="quote-estimatedDays" className={labelClass}>预计工期 / 天</label>
          <input {...inputA11y("estimatedDays")} className={inputClass} required inputMode="numeric" maxLength={16} value={fields.estimatedDays} onChange={(event) => change((previous) => ({ ...previous, estimatedDays: event.target.value }))} />
          <FieldError field="estimatedDays" errors={errors} />
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={buttonClass}>检查并预览报价</button>
          <button type="button" disabled={!canSubmit} onClick={submit} aria-describedby="quote-submit-notice" className={primaryButtonClass}>
            {submission.status === "submitting" ? "正在提交…" : "尝试提交报价"}
          </button>
        </div>
        </fieldset>
        <p id="quote-submit-notice" className={`!mb-0 mt-3 ${C.meta}`}>先预览，确认后再提交。提交失败时会保留填写内容。</p>
      </form>
      <div ref={submissionFeedback} tabIndex={-1} className="rounded-card">
        <QuoteSubmissionFeedback state={submission} onRetry={retry} />
      </div>
      <div aria-live="polite">
        {result?.kind === "preview" && submission.status === "idle" && <QuotePreview preview={result.preview} />}
      </div>
    </section>
  );
}
