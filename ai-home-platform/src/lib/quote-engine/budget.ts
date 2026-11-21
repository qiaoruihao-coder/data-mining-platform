import { Money, type DemandDTO, type QuoteDTO } from "@/contracts";
import { summarizeQuote } from "@/lib/quote-engine";

/** 只对照当前需求的列明费用；差额不表示余额，也不证明报价覆盖了完整需求。 */
export function compareQuoteBudget(demand: DemandDTO, quote: QuoteDTO) {
  if (quote.demandId !== demand.id) return null;
  const minimum = Money.parse(demand.budgetMinCents);
  const maximum = Money.parse(demand.budgetMaxCents);
  if (minimum > maximum) return null;

  const summary = summarizeQuote(quote);
  const hasPending = summary.pendingItems.length > 0;
  if (!quote.items.length) {
    return { position: "no-details" as const, differenceCents: null, hasPending };
  }
  if (quote.items.every((item) => item.amountCents === null)) {
    return { position: "unpriced" as const, differenceCents: null, hasPending };
  }

  const known = summary.knownTotalCents;
  if (known > maximum) {
    return { position: "above" as const, differenceCents: known - maximum, hasPending };
  }
  if (known === maximum) {
    return { position: "at-limit" as const, differenceCents: 0, hasPending };
  }
  if (known < minimum) {
    return { position: "below" as const, differenceCents: minimum - known, hasPending };
  }
  return { position: "within" as const, differenceCents: maximum - known, hasPending };
}
