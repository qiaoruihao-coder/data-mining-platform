"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemandDTO, TicketDTO } from "@/contracts";
import { Badge, Button, C, Card, Field, Note, SectionHead } from "./ui";
import {
  categoryLabel, isTicketAccessDenied, loadTickets, statusLabel, submitTicket, ticketErrorMessage,
  type TicketCreateForm, type TicketCreateOutcome, type TicketListResponse,
} from "./ticket-create";

const categories = ["quality", "schedule", "payment", "attitude"] as const;

function sourceLabel(source: TicketListResponse["source"]): string {
  return source === "mock" ? "模拟数据" : "已保存记录";
}

function outcomeNote(outcome: TicketCreateOutcome): { tone: "ok" | "danger" | "warn" | "info"; title: string; text: string } {
  if (outcome.kind === "created") {
    return { tone: "ok", title: "工单已提交", text: `工单编号：${outcome.ticket.id}；来源：${sourceLabel(outcome.source)}；状态：${statusLabel(outcome.ticket.status)}。` };
  }
  if (outcome.kind === "auth_required") return { tone: "warn", title: "需要业主登录", text: outcome.message };
  if (outcome.kind === "uncertain") return { tone: "warn", title: "提交结果需要核对", text: outcome.message };
  if (outcome.kind === "forbidden") return { tone: "danger", title: "没有提交权限", text: outcome.message };
  if (outcome.kind === "not_found") return { tone: "danger", title: "需求不存在", text: outcome.message };
  if (outcome.kind === "conflict") return { tone: "warn", title: "当前不能提交", text: outcome.message };
  return { tone: "danger", title: "工单提交失败", text: outcome.message };
}

function TicketList({ response }: { response: TicketListResponse }) {
  return (
    <div className="space-y-3" aria-label="本人售后工单列表">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={response.source === "mock" ? "accent" : "brand"}>工单来源：{sourceLabel(response.source)}</Badge>
        <span className={C.meta}>共 {response.data.length} 条</span>
      </div>
      {response.source === "mock" ? (
        <p className={`!mb-0 ${C.meta}`}>本列表为模拟演示数据，不能据此认定真实售后已受理或已解决。</p>
      ) : null}
      {response.data.length === 0 ? (
        <p className={`!mb-0 ${C.meta}`}>本人这条需求暂时没有已提交工单。</p>
      ) : (
        <ul className="space-y-2">
          {response.data.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
        </ul>
      )}
    </div>
  );
}

function TicketRow({ ticket }: { ticket: TicketDTO }) {
  return (
    <li className="rounded-control border border-line bg-canvas/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all text-[14px] font-medium text-ink">工单编号：{ticket.id}</span>
        <Badge tone={ticket.status === "resolved" ? "brand" : "neutral"}>{statusLabel(ticket.status)}</Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] text-ink-2">{ticket.description}</p>
      <p className={`!mb-0 mt-2 ${C.meta}`}>分类：{categoryLabel(ticket.category)}，责任服务方：{ticket.responsibleProviderId ?? "暂未指定"}</p>
    </li>
  );
}

export function TicketCreatePanel({ demand }: { demand: DemandDTO }) {
  const [listState, setListState] = useState<
    | { status: "loading" }
    | { status: "ready"; response: TicketListResponse }
    | { status: "inaccessible" }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [form, setForm] = useState<TicketCreateForm>({ description: "", category: "quality" });
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<TicketCreateOutcome | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const hasLoadedList = useRef(false);

  const refresh = useCallback(async () => {
    const preserveCurrentView = hasLoadedList.current;
    setRefreshError(null);
    if (preserveCurrentView) setRefreshing(true);
    else setListState({ status: "loading" });
    try {
      const response = await loadTickets(demand.id);
      hasLoadedList.current = true;
      setListState({ status: "ready", response });
    } catch (error) {
      if (isTicketAccessDenied(error)) {
        hasLoadedList.current = false;
        setListState({ status: "inaccessible" });
      } else if (preserveCurrentView) {
        setRefreshError(ticketErrorMessage(error));
      } else {
        setListState({ status: "error", message: ticketErrorMessage(error) });
      }
    } finally {
      setRefreshing(false);
    }
  }, [demand.id]);

  useEffect(() => {
    hasLoadedList.current = false;
    void refresh();
  }, [refresh]);

  // 先成功读取本人列表，再公开工单面板；匿名或其他业主访问公开需求时不泄露写入口。
  if (listState.status === "loading" || listState.status === "inaccessible") return null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (form.description.trim().length < 1) {
      setValidationError("请填写售后问题描述。");
      return;
    }
    if (form.description.trim().length > 4000) {
      setValidationError("问题描述不能超过 4000 字。");
      return;
    }
    setSubmitting(true);
    setOutcome(null);
    const next = await submitTicket(demand.id, form);
    setOutcome(next);
    if (next.kind === "created") {
      setForm({ description: "", category: form.category });
      await refresh();
    } else if (next.kind === "uncertain" && next.tickets) {
      setListState({ status: "ready", response: next.tickets });
    }
    setSubmitting(false);
  }

  return (
    <Card>
      <SectionHead title="售后工单" aside={<Badge tone="accent">本人需求</Badge>} />
      <p className={`mb-4 ${C.pageSub}`}>遇到质量、进度、付款或服务态度问题，可以提交一条售后工单。提交失败或网络不确定时不会自动重复提交。</p>
      {outcome ? (() => { const note = outcomeNote(outcome); return <Note tone={note.tone} title={note.title}><p>{note.text}</p></Note>; })() : null}
      {listState.status === "error" ? <Note tone="warn" title="暂时无法读取已有工单"><p>{listState.message}</p><Button variant="secondary" size="sm" onClick={() => void refresh()}>重新读取</Button></Note> : null}
      {refreshError ? <Note tone="warn" title="刷新工单失败"><p>{refreshError}</p><Button variant="secondary" size="sm" onClick={() => void refresh()}>重新读取</Button></Note> : null}
      {listState.status === "ready" ? <div className="mb-5"><TicketList response={listState.response} />{refreshing ? <p className={`mt-2 ${C.meta}`} role="status">正在刷新本人售后工单…</p> : null}</div> : null}
      <form onSubmit={handleSubmit} className="space-y-4" aria-label="提交售后工单">
        <Field label="问题分类">
          <select className={C.input} value={form.category} disabled={submitting} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as TicketCreateForm["category"] }))}>
            {categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
          </select>
        </Field>
        <Field label="问题描述" hint="1–4000 字">
          <textarea className={`${C.input} min-h-28`} value={form.description} disabled={submitting} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="请描述需要售后处理的问题" />
        </Field>
        {validationError ? <p className="!mb-0 text-[14px] text-danger" role="alert">{validationError}</p> : null}
        <Button type="submit" disabled={submitting}>{submitting ? "正在提交…" : "提交售后工单"}</Button>
      </form>
    </Card>
  );
}
