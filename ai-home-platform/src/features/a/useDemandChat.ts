"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChatResult, type ChatResultDTO } from "@/contracts";
import { ApiClientError, apiPost } from "@/lib/api-client";
import {
  appendMessage,
  fieldLabel,
  normalizeOutgoing,
  toChatPayload,
  type ChatMessage,
  type EnvelopeSource,
} from "./demand-chat";

export const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "您好，请描述房子的情况和您想怎么改，例如城市、面积、预算范围和期望工期。请留意返回结果的来源：模拟追问仅供演示，您也可以直接手动填写需求单。",
};

export type ChatPhase = "idle" | "sending" | "failed";

export type DemandChatState = {
  messages: ChatMessage[];
  phase: ChatPhase;
  error: string | null;
  result: ChatResultDTO | null;
  source: EnvelopeSource | null;
  canRetry: boolean;
  missingLabels: string[];
};

/**
 * 需求澄清对话状态机。
 * 请求失败时保留用户消息并提供重试；接口返回的 draft/source 原样透出，不补齐、不猜测。
 */
export function useDemandChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResultDTO | null>(null);
  const [source, setSource] = useState<EnvelopeSource | null>(null);
  const failedHistory = useRef<ChatMessage[] | null>(null);
  const inFlight = useRef(false);

  const request = useCallback(async (history: ChatMessage[]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("sending");
    setError(null);
    try {
      const parsed = await apiPost("/api/demand/chat", toChatPayload(history), ChatResult);
      failedHistory.current = null;
      setMessages((current) => appendMessage(current, { role: "assistant", content: parsed.data.reply }));
      setResult(parsed.data);
      setSource(parsed.source);
      setPhase("idle");
    } catch (cause) {
      failedHistory.current = history;
      setPhase("failed");
      if (cause instanceof ApiClientError) {
        setError(cause.status === 503
          ? "需求助手暂时不可用，请稍后重试。"
          : "需求助手暂时没有完成请求，请检查描述后重试。");
      } else {
        setError("网络异常，请求没有完成。");
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (inFlight.current) return;
      const normalized = normalizeOutgoing(text);
      if (!normalized.ok) {
        setError(normalized.message);
        setPhase("failed");
        failedHistory.current = null;
        return;
      }
      const nextHistory = appendMessage(messages, { role: "user", content: normalized.value });
      setMessages(nextHistory);
      await request(nextHistory);
    },
    [messages, request],
  );

  /** 重试只重发上一次请求，不重复追加用户消息 */
  const retry = useCallback(async () => {
    if (!failedHistory.current) return;
    await request(failedHistory.current);
  }, [request]);

  const reset = useCallback(() => {
    if (inFlight.current) return;
    failedHistory.current = null;
    setMessages([GREETING]);
    setResult(null);
    setSource(null);
    setPhase("idle");
    setError(null);
  }, []);

  const missingLabels = useMemo(
    () => (result ? result.missingFields.map(fieldLabel) : []),
    [result],
  );

  const state: DemandChatState = {
    messages,
    phase,
    error,
    result,
    source,
    canRetry: phase === "failed" && failedHistory.current !== null,
    missingLabels,
  };
  return { ...state, send, retry, reset };
}
