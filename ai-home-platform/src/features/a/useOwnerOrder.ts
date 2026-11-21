"use client";

import { useCallback, useEffect, useState } from "react";
import { loadOwnerOrder, type OwnerOrderState } from "./owner-order";

const LOADING: OwnerOrderState = { phase: "loading" };

export function useOwnerOrder(demandId: string) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ id: string; attempt: number; state: OwnerOrderState }>({ id: demandId, attempt, state: LOADING });
  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    void loadOwnerOrder(demandId).then((state) => {
      if (active) setSnapshot({ id: demandId, attempt, state });
    });
    return () => { active = false; };
  }, [demandId, attempt]);

  const state = snapshot.id === demandId && snapshot.attempt === attempt ? snapshot.state : LOADING;
  return { ...state, reload };
}
