"use client";

import { useEffect, useState } from "react";
import type { DemandDTO, OrderSummaryDTO } from "@/contracts";
import { statusLabel } from "./demand-list";
import { Badge, Button, C, Card, Field, Note, SectionHead } from "./ui";
import {
  isReviewAccessDenied, loadOwnerOrder, loadReviews, reviewErrorMessage, reviewSourceLabel, submitReview,
  type OwnerOrderResponse, type ReviewForm, type ReviewListResponse, type ReviewSubmitOutcome,
} from "./review";

type ReviewPanelState =
  | { phase: "checking" }
  | { phase: "ready"; order: OwnerOrderResponse; reviews: ReviewListResponse }
  | { phase: "failed"; message: string };

function ReviewOutcome({ outcome }: { outcome: ReviewSubmitOutcome }) {
  if (outcome.kind === "created") {
    return <Note tone="ok" title="评价已提交"><p>评价编号：{outcome.review.id}；来源：{reviewSourceLabel(outcome.source)}。</p></Note>;
  }
  if (outcome.kind === "confirmed") {
    return <Note tone="info" title="已读取到评价"><p>检测到这笔接单已有评价，来源：{reviewSourceLabel(outcome.source)}；页面不会覆盖原评价。</p></Note>;
  }
  const tone = outcome.kind === "auth_required" || outcome.kind === "conflict" || outcome.kind === "uncertain" ? "warn" : "danger";
  const title = outcome.kind === "auth_required" ? "需要业主登录" : outcome.kind === "uncertain" ? "提交结果需要核对" : "评价提交失败";
  return <Note tone={tone} title={title}><p>{outcome.message}</p></Note>;
}

function ExistingReview({ response }: { response: ReviewListResponse }) {
  const review = response.data[0];
  if (!review) return null;
  return (
    <Note tone="info" title="已提交评价">
      <p>评分：{review.rating} / 5；来源：{reviewSourceLabel(review.source)}。</p>
      <p className="whitespace-pre-wrap break-words">{review.comment || "未填写文字评价。"}</p>
      <p className={`!mb-0 ${C.meta}`}>评价已保存，当前页面不提供覆盖操作。</p>
    </Note>
  );
}

export function ReviewPanelContent({
  demand, order, reviews, onSubmit,
}: {
  demand: DemandDTO;
  order?: OwnerOrderResponse;
  reviews?: ReviewListResponse;
  onSubmit?: (form: ReviewForm) => Promise<ReviewSubmitOutcome>;
}) {
  if (demand.status !== "completed") {
    return (
      <Card>
        <SectionHead title="服务评价" aside={<Badge tone="neutral">完成后开放</Badge>} />
        <Note tone="info">
          <p>需求完成后可评价。</p>
          <p>当前状态：{statusLabel(demand.status)}。完成状态由履约流程确认后，评价入口才会开放。</p>
        </Note>
      </Card>
    );
  }

  if (!order?.order) {
    return (
      <Card>
        <SectionHead title="服务评价" aside={<Badge tone="neutral">暂未开放</Badge>} />
        <Note tone="info">
          <p>未查到已完成订单，暂不能评价。</p>
          <p>请刷新订单后重试。</p>
        </Note>
      </Card>
    );
  }

  if (reviews?.data[0]) {
    return (
      <Card>
        <SectionHead title="服务评价" aside={<Badge tone="brand">已评价</Badge>} />
        <ExistingReview response={reviews} />
      </Card>
    );
  }

  const submit = onSubmit ?? (async () => ({ kind: "failed", message: "评价表单尚未连接。" } as const));
  return <ReviewFormPanel order={{ order: order.order, source: order.source }} onSubmit={submit} />;
}

function ReviewFormPanel({ order, onSubmit }: { order: { order: OrderSummaryDTO; source: "mock" | "live" }; onSubmit: (form: ReviewForm) => Promise<ReviewSubmitOutcome> }) {
  const [form, setForm] = useState<ReviewForm>({ rating: 5, comment: "" });
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReviewSubmitOutcome | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (!Number.isInteger(form.rating) || form.rating < 1 || form.rating > 5) {
      setValidationError("请选择 1–5 分的整数评分。");
      return;
    }
    if (form.comment.trim().length > 2000) {
      setValidationError("评价内容不能超过 2000 字。");
      return;
    }
    setSubmitting(true);
    setOutcome(null);
    const next = await onSubmit({ rating: form.rating, comment: form.comment });
    setOutcome(next);
    setSubmitting(false);
  }

  const locked = outcome?.kind === "created" || outcome?.kind === "confirmed";
  return (
    <Card>
      <SectionHead title="服务评价" aside={<Badge tone="accent">待评价</Badge>} />
      <p className={`mb-4 ${C.pageSub}`}>评价对象：已完成接单的服务方。评价只保存一次，提交后不能覆盖。</p>
      {outcome ? <ReviewOutcome outcome={outcome} /> : null}
      <form onSubmit={handleSubmit} className="space-y-4" aria-label="提交服务评价">
        <Field label="评分">
          <select className={C.input} value={form.rating} disabled={submitting || locked} onChange={(event) => setForm((current) => ({ ...current, rating: Number(event.target.value) }))}>
            {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} 分</option>)}
          </select>
        </Field>
        <Field label="评价内容" hint="可选，最多 2000 字">
          <textarea className={`${C.input} min-h-28`} value={form.comment} disabled={submitting || locked} onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))} placeholder="可以留下对本次服务的具体评价" />
        </Field>
        {validationError ? <p className="!mb-0 text-[14px] text-danger" role="alert">{validationError}</p> : null}
        <Button type="submit" disabled={submitting || locked}>{submitting ? "正在提交…" : "提交评价"}</Button>
      </form>
      <p className={`mt-3 !mb-0 ${C.meta}`}>接单编号：{order.order.id}，服务方：{order.order.providerId}，来源：{reviewSourceLabel(order.source)}</p>
    </Card>
  );
}

export function ReviewPanel({ demand }: { demand: DemandDTO }) {
  const [state, setState] = useState<ReviewPanelState>({ phase: "checking" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ phase: "checking" });
    void Promise.all([loadOwnerOrder(demand.id), loadReviews(demand.id)])
      .then(([order, reviews]) => { if (active) setState({ phase: "ready", order, reviews }); })
      .catch((error) => {
        if (!active) return;
        if (isReviewAccessDenied(error)) setState({ phase: "failed", message: "" });
        else setState({ phase: "failed", message: reviewErrorMessage(error) });
      });
    return () => { active = false; };
  }, [demand.id, reloadKey]);

  if (state.phase === "checking" || (state.phase === "failed" && !state.message)) return null;
  if (state.phase === "failed") {
    return <Card><SectionHead title="服务评价" aside={<Badge tone="danger">读取失败</Badge>} /><Note tone="danger"><p>{state.message}</p><Button variant="secondary" size="sm" onClick={() => setReloadKey((value) => value + 1)}>重新读取</Button></Note></Card>;
  }

  const { order, reviews } = state;
  const currentOrder = order.order;
  return (
    <ReviewPanelContent
      demand={demand}
      order={order}
      reviews={reviews}
      onSubmit={async (form) => {
        if (!currentOrder) return { kind: "failed", message: "没有读取到可评价的接单服务方。" };
        const outcome = await submitReview(demand.id, currentOrder.providerId, form);
        if (outcome.kind === "confirmed" || outcome.kind === "created") setState({ phase: "ready", order, reviews: { data: [outcome.review], source: outcome.source } });
        return outcome;
      }}
    />
  );
}
