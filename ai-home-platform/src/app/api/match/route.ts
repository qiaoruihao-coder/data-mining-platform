import type { ApiFailure } from "@/contracts";
import { loadMatchData } from "@/lib/match/data";
import { ProviderDirectoryError } from "@/lib/provider-directory";
import { MatchingDemandAccessError, matchingDemandFailureResponse, MATCHING_DEMAND_RESPONSE_HEADERS } from "@/lib/matching-demand";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await loadMatchData(request);
    return Response.json(result.response, { headers: MATCHING_DEMAND_RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof MatchingDemandAccessError) return matchingDemandFailureResponse(error);
    if (error instanceof ProviderDirectoryError) return Response.json({
      ok: false,
      error: { code: error.code, message: "服务方评价汇总暂时无法读取，请稍后重试。" },
    } satisfies ApiFailure, { status: 503, headers: MATCHING_DEMAND_RESPONSE_HEADERS });
    return Response.json({
      ok: false,
      error: { code: "DATABASE_UNAVAILABLE", message: "需求数据暂时无法读取，请稍后重试。" },
    } satisfies ApiFailure, { status: 503, headers: MATCHING_DEMAND_RESPONSE_HEADERS });
  }
}
