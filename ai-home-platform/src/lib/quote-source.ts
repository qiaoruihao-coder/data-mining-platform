import { Demand, Quote, Source, type DemandDTO, type QuoteDTO, type SourceDTO } from "@/contracts";

const QuoteSourceList = Quote.pick({ source: true }).array();

/** 数据库来源非空；损坏或缺失必须抛错，不能套用旧 DTO 的可选语义。 */
export function parseStoredQuoteSource(value: unknown): SourceDTO {
  return Source.parse(value);
}

/**
 * 仅对已通过授权和状态过滤的返回列表汇总来源，不参与授权。
 * 数据库调用方须先逐条 parseStoredQuoteSource；兼容 DTO 缺省保守标 mock。
 */
export function summarizeQuoteSources(
  demandSource: DemandDTO["source"],
  quotes: readonly Pick<QuoteDTO, "source">[],
): SourceDTO {
  const demand = Demand.shape.source.parse(demandSource);
  // 先校验全部条目，避免遇到 mock 就短路而掩盖后面的损坏数据。
  const sources = QuoteSourceList.parse(quotes);
  return demand === "live" && sources.every(quote => quote.source === "live") ? "live" : "mock";
}
