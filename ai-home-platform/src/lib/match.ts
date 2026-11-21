import type { z } from "zod";
import { Match, ProviderPerformance, type DemandDTO, type ProviderDTO } from "@/contracts";
import { assessAvailability } from "@/lib/match/availability";

export const renovationLabels: Record<DemandDTO["renovationType"], string> = {
  elderly: "适老化",
  partial: "局部改造",
  repair: "维修",
};

/** 城市和工种为硬条件；标签匹配 60 分，评分占 40 分。 */
export function matchProviders(
  demand: DemandDTO,
  candidates: ProviderDTO[],
  now = Date.now(),
): z.infer<typeof Match>[] {
  const city = demand.city.trim();
  const specialty = renovationLabels[demand.renovationType];
  if (!city) return [];

  const matches = candidates
    .filter((provider) => provider.city.trim() === city && provider.kind === "construction")
    .map((provider) => {
      const hasSpecialty = provider.tags.some((tag) => tag.trim() === specialty);
      const ratingPoints = Math.round(provider.rating * 8);
      return {
        provider,
        score: (hasSpecialty ? 60 : 0) + ratingPoints,
        reasons: [
          `服务城市与需求一致：${city}`,
          "服务类型为施工团队",
          hasSpecialty
            ? `擅长标签包含「${specialty}」：+60 分`
            : `未标注「${specialty}」经验：+0 分，需进一步确认`,
          `评分 ${provider.rating}/5：+${ratingPoints} 分（评分 × 8，四舍五入）`,
        ],
      };
    });
  const groups = new Map<number, typeof matches>();
  for (const match of matches) {
    const group = groups.get(match.score) ?? [];
    group.push(match);
    groups.set(match.score, group);
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).flatMap(([, group]) => {
    // 先按整个同分组决定是否启用，不能在比较两人时临时跳过未知值。
    const performances = group.map(match => ProviderPerformance.safeParse(match.provider.performance));
    const sources = new Set(performances.flatMap(value => value.success ? [value.data.source] : []));
    const enabled = group.length > 1 && sources.size === 1
      && performances.every(value => value.success && value.data.averageRating !== null && value.data.reviewCount > 0);
    const availability = new Map(group.map(match => [match, assessAvailability(match.provider.availability, demand.desiredDays, now)]));
    const windows = [...availability.values()];
    const availabilityEnabled = group.length > 1 && windows.every(value => value.fits !== null)
      && new Set(windows.map(value => value.data?.source)).size === 1;
    const availabilityReason = group.length === 1 ? "本基础分组仅一位候选，档期不改变跨组顺序。"
      : availabilityEnabled ? "同基础分组档期在读取时有效且来源一致；前序规则仍同序时，单段剩余窗口可容纳期望天数的候选优先，再按编号稳定展示。"
        : "同基础分组存在未知、待更新或来源不一致的档期，整组不使用档期细排；前序规则仍同序时按编号展示，未知不淘汰。";
    for (const match of group) match.reasons.push(availabilityReason);
    const reason = group.length === 1 ? "本基础分组仅一位候选，评价均分不改变跨组顺序。"
      : enabled ? "同基础分组评价数据完整且来源一致，按已完成接单评价均分降序；均分相同时再判断是否可用档期细排。"
        : "同基础分组有评价缺失、无样本或来源不一致，整组不使用评价细排；未知不当零分，再判断是否可用档期细排。";
    for (const match of group) match.reasons.push(reason);
    return group.sort((a, b) => {
      if (enabled) {
        // 整组验证已保证均分非 null；不使用默认 0 补齐。
        const difference = b.provider.performance!.averageRating! - a.provider.performance!.averageRating!;
        if (difference !== 0) return difference;
      }
      if (availabilityEnabled) {
        const difference = Number(availability.get(b)!.fits) - Number(availability.get(a)!.fits);
        if (difference !== 0) return difference;
      }
      return a.provider.id < b.provider.id ? -1 : a.provider.id > b.provider.id ? 1 : 0;
    });
  });
}
