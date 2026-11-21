"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Demand, type DemandDTO } from "@/contracts";
import { apiGet } from "@/lib/api-client";
import type { EnvelopeSource } from "./demand-chat";

export type ListPhase = "loading" | "ready" | "failed";

export type DemandListState = {
  phase: ListPhase;
  items: DemandDTO[];
  source: EnvelopeSource | null;
  error: string | null;
};

const LOADING: DemandListState = { phase: "loading", items: [], source: null, error: null };

/** 只解析公共契约，不读取尚未约定的逐条来源字段。 */
export async function loadDemandList(): Promise<DemandListState> {
  try {
    const result = await apiGet("/api/demand", Demand.array());
    return { phase: "ready", items: result.data, source: result.meta.source, error: null };
  } catch (cause) {
    return {
      phase: "failed", items: [], source: null,
      error: cause instanceof Error ? cause.message : "需求列表加载失败。",
    };
  }
}

/** 每次刷新清空旧展示，只采用最新请求；卸载后忽略迟到的响应。 */
export function useDemandList() {
  const [state, setState] = useState<DemandListState>(LOADING);
  const requestVersion = useRef({ value: 0 });

  const load = useCallback(async () => {
    const version = ++requestVersion.current.value;
    setState(LOADING);
    const next = await loadDemandList();
    if (version === requestVersion.current.value) setState(next);
  }, []);

  useEffect(() => {
    // 捕获稳定的计数对象；清理时仍递增最新值，使所有未完成请求失效。
    const requests = requestVersion.current;
    void load();
    return () => { requests.value++; };
  }, [load]);

  return { ...state, reload: load };
}
