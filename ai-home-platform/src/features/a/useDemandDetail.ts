"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadDemandDetail, type DemandDetailState } from "./demand-detail";

const LOADING: DemandDetailState = { phase: "loading" };

/** 只让最新请求更新页面；切换 ID 时立即隐藏上一条需求和它的操作链接。 */
export function useDemandDetail(id: string) {
  const [snapshot, setSnapshot] = useState<{ id: string; state: DemandDetailState }>({ id, state: LOADING });
  const requestVersion = useRef({ value: 0 });

  const reload = useCallback(async () => {
    const version = ++requestVersion.current.value;
    setSnapshot({ id, state: LOADING });
    const state = await loadDemandDetail(id);
    if (version === requestVersion.current.value) setSnapshot({ id, state });
  }, [id]);

  useEffect(() => {
    // 捕获稳定的计数对象；清理时仍递增最新值，使所有未完成请求失效。
    const requests = requestVersion.current;
    void reload();
    return () => { requests.value++; };
  }, [reload]);

  return { state: snapshot.id === id ? snapshot.state : LOADING, reload };
}
