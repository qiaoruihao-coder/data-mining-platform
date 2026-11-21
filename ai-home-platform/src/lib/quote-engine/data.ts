import { Quote, envelope } from "@/contracts";
import { demoDemand, providers, quotes } from "@/lib/mock-data";
import { prepareQuotes } from "@/lib/quote-engine";

/** D 的真实查询接通前，只识别明确存在的演示需求。 */
export function loadQuoteData(demandId = demoDemand.id) {
  if (demandId !== demoDemand.id) return null;
  return {
    demand: demoDemand,
    providers,
    response: envelope(Quote.array()).parse({
      ok: true,
      data: prepareQuotes(demandId, quotes),
      meta: { source: "mock" },
    }),
  };
}
