import type { PrismaClient } from "@prisma/client";
import {
  authorizeOwnerQuoteRead, parseQuoteQuery, OwnerAccessError,
  ownerAccessFailureResponse, QUOTE_READ_RESPONSE_HEADERS,
} from "@/lib/server-auth";
import { loadQuoteData } from "@/lib/quote-engine/data";
import { readStoredQuoteComparison, QuoteReadDenied } from "@/lib/quote-engine/read";

/** 只允许 D 的事务授权器决定读取范围；不接受调用方提供的身份或授权快照。 */
export async function handleQuoteRead(request: Request, db?: Pick<PrismaClient, "$transaction">) {
  try {
    const query = parseQuoteQuery(new URL(request.url).searchParams);
    if (query === null) {
      return Response.json(loadQuoteData()!.response, { headers: QUOTE_READ_RESPONSE_HEADERS });
    }
    const result = await readStoredQuoteComparison(request, query.demandId, authorizeOwnerQuoteRead, db);
    if (!result) throw new OwnerAccessError("DEMAND_NOT_FOUND");
    return Response.json(result.response, { headers: QUOTE_READ_RESPONSE_HEADERS });
  } catch (error) {
    return ownerAccessFailureResponse(error instanceof OwnerAccessError ? error
      : new OwnerAccessError(error instanceof QuoteReadDenied ? "FORBIDDEN" : "DATABASE_UNAVAILABLE"));
  }
}
