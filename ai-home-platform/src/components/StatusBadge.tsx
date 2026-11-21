import React from "react";
import { C } from "@/components/ui";

export function StatusBadge({ label }: { label: string }) {
  return <span className={`${C.badge} ${C.badgeNeutral}`}>{label}</span>;
}
