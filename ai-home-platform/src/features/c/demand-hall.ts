import { Demand, type DemandDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";
import { demandAccessFailure } from "./demand-access-recovery";

export const renovationLabels: Record<DemandDTO["renovationType"], string> = {
  elderly: "适老化改造",
  partial: "局部改造",
  repair: "维修",
};

export type DemandHallFilters = Readonly<{
  keyword: string;
  renovationType: "all" | DemandDTO["renovationType"];
}>;
export const defaultDemandHallFilters: DemandHallFilters = { keyword: "", renovationType: "all" };
export const demandHallRenovationOptions = ["all", ...Demand.shape.renovationType.options] as const;

export function filterHallDemands(demands: readonly DemandDTO[], filters: DemandHallFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return demands.filter(demand => demand.status === "published"
    && (filters.renovationType === "all" || demand.renovationType === filters.renovationType)
    && (!keyword || [demand.id, demand.city, demand.description].some(value => value.toLowerCase().includes(keyword))));
}

export async function loadDemandHall() {
  const response = await apiGet("/api/demand", Demand.array());
  return {
    ...response,
    data: response.data.filter((demand) => demand.status === "published"),
  };
}

export type DemandHallState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadDemandHall>> }
  | { status: "error"; message: string; canExitOwnerSession?: boolean };

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBudget(cents: number) {
  return currency.format(cents / 100);
}

export function demandHallErrorMessage(error: unknown) {
  return demandHallFailureState(error).message;
}

export function demandHallFailureState(error: unknown): Extract<DemandHallState, { status: "error" }> {
  const access = demandAccessFailure(error);
  if (access) return { status: "error", ...access };
  if (error instanceof ApiClientError && error.status === 501) {
    return { status: "error", message: "需求接口尚未实现，暂时无法读取需求，请等待接口接入后重试。" };
  }
  if (error instanceof ApiClientError && error.status === 503) {
    return { status: "error", message: "需求服务暂时不可用，请稍后重试。" };
  }
  return { status: "error", message: "需求列表加载失败，请检查网络或稍后重试。" };
}
