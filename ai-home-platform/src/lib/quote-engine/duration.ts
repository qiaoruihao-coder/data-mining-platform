import { Demand, Quote, type DemandDTO, type QuoteDTO } from "@/contracts";

/** 只比较报价估计与当前需求期望，不推断开工日期、可用档期或履约能力。 */
export function compareQuoteDuration(demand: DemandDTO, quote: QuoteDTO) {
  if (quote.demandId !== demand.id) return null;
  const desired = Demand.shape.desiredDays.safeParse(demand.desiredDays);
  const estimated = Quote.shape.estimatedDays.safeParse(quote.estimatedDays);
  // 历史输出契约尚未限制安全整数；不对已失去精度的天数计算差额。
  if (!desired.success || !estimated.success ||
      !Number.isSafeInteger(desired.data) || !Number.isSafeInteger(estimated.data)) {
    return { position: "unavailable" as const, differenceDays: null };
  }
  if (estimated.data > desired.data) {
    return { position: "longer" as const, differenceDays: estimated.data - desired.data };
  }
  if (estimated.data < desired.data) {
    return { position: "shorter" as const, differenceDays: desired.data - estimated.data };
  }
  return { position: "equal" as const, differenceDays: 0 };
}
