"use client";

import { useCallback, useEffect, useState } from "react";
import { loadSchedule, SCHEDULE_LOADING, type ScheduleState } from "./schedule-query";

export type { ScheduleState } from "./schedule-query";

/** 切换需求或刷新时立即隐藏旧数据，忽略已失效请求的结果。 */
export function useSchedule(id: string, version?: number) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ id: string; version?: number; attempt: number; state: ScheduleState }>({
    id, version, attempt, state: SCHEDULE_LOADING,
  });
  const reload = useCallback(() => setAttempt(current => current + 1), []);

  useEffect(() => {
    let active = true;
    void loadSchedule(id, version).then(state => {
      if (active) setSnapshot({ id, version, attempt, state });
    });
    return () => { active = false; };
  }, [id, version, attempt]);

  const state = snapshot.id === id && snapshot.version === version && snapshot.attempt === attempt ? snapshot.state : SCHEDULE_LOADING;
  return { ...state, reload };
}
