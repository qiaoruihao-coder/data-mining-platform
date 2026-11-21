import { Schedule, ScheduleQuery } from "@/contracts";
import type { ScheduleDTO, SourceDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export type ScheduleState = {
  phase: "loading" | "ready" | "missing" | "failed";
  data: ScheduleDTO | null;
  source: SourceDTO | null;
  error: string | null;
};

export const SCHEDULE_LOADING: ScheduleState = {
  phase: "loading", data: null, source: null, error: null,
};

/** 省略 version 读取当前需求的最新版本；失败时不回退到演示排期。 */
export async function loadSchedule(id: string, version?: number): Promise<ScheduleState> {
  const failed = (error: string): ScheduleState => ({ phase: "failed", data: null, source: null, error });
  if (!ScheduleQuery.safeParse({ demandId: id, version }).success) {
    return failed("需求编号或排期版本无效，请检查后重试。");
  }
  try {
    const query = `/api/schedule?demandId=${encodeURIComponent(id)}${version === undefined ? "" : `&version=${version}`}`;
    const result = await apiGet(query, Schedule);
    if (result.data.demandId !== id) return failed("接口返回了另一条需求的排期，已停止展示，请重新加载。");
    if (version !== undefined && result.data.version !== version) return failed("接口返回的排期版本与所选版本不一致，已停止展示，请重新加载。");
    return { phase: "ready", data: result.data, source: result.meta.source, error: null };
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      if (cause.status === 404 && cause.code === "SCHEDULE_NOT_FOUND") {
        return { phase: "missing", data: null, source: null, error: null };
      }
      if (cause.status === 501) return failed("排期读取接口尚未开放（HTTP 501），请稍后重试。");
      return failed(cause.message);
    }
    return failed("施工进度加载失败，请重新加载。");
  }
}

/** 输入只接受十进制正整数，数值上限由公共查询契约决定。 */
export function parseScheduleVersion(input: string): number | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = ScheduleQuery.shape.version.unwrap().safeParse(Number(text));
  return parsed.success ? parsed.data : null;
}
