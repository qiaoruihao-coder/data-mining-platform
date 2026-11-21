"use client";

import { useState } from "react";
import { DemandDraftPanel } from "@/features/a/DemandDraftPanel";
import { useDemandChat } from "@/features/a/useDemandChat";
import { normalizeOutgoing, sourceLabel } from "@/features/a/demand-chat";
import { Badge, Button, C, Card, Note, SectionHead } from "@/features/a/ui";

const QUICK_PHRASES = [
  "深圳 60 平老房，给老人住，卫生间太滑，想加扶手",
  "厨房漏水，橱柜底板发霉，预算 1 万左右",
];

/** 头像：让对话看起来像两个人的往来，而不是两条文本 */
function Avatar({ me }: { me: boolean }) {
  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
        me ? "bg-brand-soft text-brand-hover" : "bg-wood-soft text-warn"
      }`}
      aria-hidden
    >
      {me ? "我" : "AI"}
    </span>
  );
}

export function ChatWindow() {
  const { messages, phase, error, result, source, canRetry, send, retry, reset } = useDemandChat();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState(0);
  const sending = phase === "sending";
  const busy = sending || saving;

  const restart = () => {
    if (busy) return;
    reset();
    setText("");
    setSession((current) => current + 1);
  };

  const submit = async () => {
    if (busy) return;
    const value = text;
    if (normalizeOutgoing(value).ok) setText("");
    await send(value);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <Card>
        <SectionHead
          title="对话"
          aside={
            <Badge tone={source === "live" ? "brand" : "accent"}>
              {sourceLabel(source)}
            </Badge>
          }
        />


        <ol
          className="mt-4 grid max-h-[480px] gap-3 overflow-y-auto rounded-card bg-canvas p-4"
          aria-live="polite"
        >
          {messages.map((message, index) => {
            const me = message.role === "user";
            return (
              <li key={`${message.role}-${index}`} className="flex items-start gap-2.5">
                <Avatar me={me} />
                <div
                  className={
                    me
                      ? "max-w-[84%] rounded-card rounded-tl-[4px] bg-brand px-4 py-3 text-[15px] leading-relaxed text-white"
                      : "max-w-[84%] rounded-card rounded-tl-[4px] border border-line bg-white px-4 py-3 text-[15px] leading-relaxed text-ink"
                  }
                >
                  <span
                    className={`mb-1 block text-[13px] ${me ? "text-white/80" : "text-ink-3"}`}
                  >
                    {me ? "我" : "需求澄清助手"}
                  </span>
                  {message.content}
                </div>
              </li>
            );
          })}
          {sending && (
            <li className="flex items-start gap-2.5">
              <Avatar me={false} />
              <div className="rounded-card rounded-tl-[4px] border border-line bg-white px-4 py-3 text-[15px] text-ink-3">
                助手正在整理需求…
              </div>
            </li>
          )}
        </ol>

        {error && (
          <div className="mt-3">
            <Note tone="danger" title="对话请求失败">
              <p>{error}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {canRetry && (
                  <Button variant="danger" size="sm" onClick={retry} disabled={busy}>
                    重试上一次请求
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={restart} disabled={busy}>
                  重新开始
                </Button>
              </div>
            </Note>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              className={C.pill}
              onClick={() => setText(phrase)}
              disabled={busy}
            >
              {phrase}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2.5">
          <textarea
            aria-label="需求描述消息"
            className={`min-h-[96px] resize-y ${C.input}`}
            placeholder="用一句话说说房子的情况和您想怎么改，例如：深圳 60 平老房，给老人住，卫生间太滑，预算 3-5 万，一个月内完工"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void submit()} disabled={busy || text.trim().length === 0}>
              {sending ? "发送中…" : "发送"}
            </Button>
            <Button variant="secondary" onClick={restart} disabled={busy}>
              清空对话
            </Button>
            <span className={C.meta}>Enter 发送，Shift+Enter 换行</span>
          </div>
        </div>
      </Card>

      <DemandDraftPanel key={session} result={result} source={source} onSubmittingChange={setSaving} />
    </div>
  );
}
