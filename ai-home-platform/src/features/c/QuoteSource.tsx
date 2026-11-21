import React from "react";
import type { QuoteDTO, SourceDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";

const labels: Record<SourceDTO, string> = {
  mock: "模拟报价",
  live: "已保存报价",
};

export function QuoteSource({ source }: Pick<QuoteDTO, "source">) {
  return <StatusBadge label={source === undefined ? "报价来源待确认" : labels[source]} />;
}
