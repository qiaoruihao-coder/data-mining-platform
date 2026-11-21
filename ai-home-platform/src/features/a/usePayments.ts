"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Payment } from "@/contracts";
import { apiGet } from "@/lib/api-client";
import type { PaymentDTO } from "./payments";

export type Phase = "loading" | "ready" | "failed";

export type PaymentsState = {
  phase: Phase;
  items: PaymentDTO[];
  source: "mock" | "live" | null;
  error: string | null;
};

/** 读取付款节点（GET /api/payment）；失败可重试，前端不兜造节点 */
export function usePayments() {
  const [state, setState] = useState<PaymentsState>({
    phase: "loading",
    items: [],
    source: null,
    error: null,
  });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => ({ ...current, phase: "loading", error: null }));
    try {
      const result = await apiGet("/api/payment", Payment.array());
      setState({
        phase: "ready",
        items: result.data,
        source: result.meta.source,
        error: null,
      });
    } catch (cause) {
      setState({
        phase: "failed",
        items: [],
        source: null,
        error: cause instanceof Error ? cause.message : "付款节点加载失败。",
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
