import { Match, envelope } from "@/contracts";
import { readMatchingDemand } from "@/lib/matching-demand";
import { readProviderDirectory } from "@/lib/provider-directory";
import { matchProviders } from "@/lib/match";

const MatchResponse = envelope(Match.array());

/** 原始请求先交 D 在事务中校验参数、会话及需求范围；拒绝时不读取目录。 */
export async function loadMatchData(request: Request) {
  const result = await readMatchingDemand(request);
  // 与浏览器 GET /api/provider 的缺省口径一致；没有 live 样本不改用 mock。
  const directory = await readProviderDirectory();
  return {
    demand: result.data,
    response: MatchResponse.parse({
      ok: true,
      data: matchProviders(result.data, directory.data),
      meta: { source: result.meta.source === "live" && directory.meta.source === "live" ? "live" : "mock" },
    }),
  };
}
