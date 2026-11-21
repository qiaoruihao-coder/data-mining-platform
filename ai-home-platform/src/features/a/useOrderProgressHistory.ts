"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadOrderProgressHistory,
  ORDER_PROGRESS_HISTORY_LOADING,
  type OrderProgressHistoryState,
} from "./order-progress-history";

export type { OrderProgressHistoryState } from "./order-progress-history";

export function useOrderProgressHistory(demandId: string, revision: number) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ id: string; revision: number; attempt: number; state: OrderProgressHistoryState }>({
    id: demandId,
    revision,
    attempt,
    state: ORDER_PROGRESS_HISTORY_LOADING,
  });
  const reload = useCallback(() => setAttempt(current => current + 1), []);

  useEffect(() => {
    let active = true;
    void loadOrderProgressHistory(demandId).then(state => {
      if (active) setSnapshot({ id: demandId, revision, attempt, state });
    });
    return () => { active = false; };
  }, [demandId, revision, attempt]);

  const state = snapshot.id === demandId && snapshot.revision === revision && snapshot.attempt === attempt
    ? snapshot.state
    : ORDER_PROGRESS_HISTORY_LOADING;
  return { ...state, reload };
}
