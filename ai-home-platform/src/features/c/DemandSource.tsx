import React from "react";
import type { DemandDTO, SourceDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";

const labels: Record<SourceDTO, string> = {
  mock: "模拟需求",
  live: "已保存需求",
};

export function DemandSource({ source }: Pick<DemandDTO, "source">) {
  return <StatusBadge label={source === undefined ? "需求来源待确认" : labels[source]} />;
}
