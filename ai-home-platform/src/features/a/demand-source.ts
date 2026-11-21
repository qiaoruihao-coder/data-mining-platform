/**
 * 逐条来源标识。
 *
 * 列表信封的 meta.source 只描述本次接口响应，逐条来源必须读取公共 Demand.source。
 */
import type { DemandDTO, SourceDTO } from "@/contracts";

/** 单条需求的来源；缺失时保持未知，不从整批来源或其他字段推断。 */
export function itemSource(item: DemandDTO): SourceDTO | null {
  return item.source ?? null;
}

/** 逐条徽标文案：只有确认为模拟时才提示，真实数据不加噪音 */
export function itemSourceBadge(item: DemandDTO): string | null {
  return itemSource(item) === "mock" ? "模拟数据" : null;
}

/** 列表整体说明：不再断言「只返回演示需求」，改为说明本次接口的来源与落库行为 */
export function listSourceNote(source: "mock" | "live" | null): string {
  if (source === "live") {
    return "说明：本次列表来自真实数据库（source: live）。保存新需求后，可点击刷新列表查看。";
  }
  if (source === "mock") {
    return "说明：本次列表标记为 mock，可能混有模拟数据和实际保存的需求；每条需求的来源以 demand.source 为准。";
  }
  return "说明：列表来源未知，页面按接口原样展示，不猜测数据的真假。";
}
