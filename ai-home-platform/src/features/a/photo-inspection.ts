import { ApiClientError, apiPost } from "@/lib/api-client";
import { InspectionUploadResult, PhotoInspectionInput, PhotoInspectionResult, envelope } from "@/contracts";
import type { InspectionUploadResultDTO, PhotoInspectionResultDTO, SourceDTO } from "@/contracts";

export type PhotoInspectionPhase = "idle" | "selected" | "invalid" | "submitting" | "ready" | "unavailable" | "failed";

export type InspectionUploadResponse = {
  data: InspectionUploadResultDTO;
  source: SourceDTO;
};

export type PhotoInspectionResponse = {
  data: PhotoInspectionResultDTO;
  source: SourceDTO;
};

function failureFromPayload(payload: unknown, status: number): ApiClientError {
  if (typeof payload === "object" && payload !== null) {
    const failure = payload as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
    if (failure.ok === false && typeof failure.error?.code === "string" && typeof failure.error.message === "string") {
      return new ApiClientError(`${failure.error.message}（HTTP ${status}）。`, failure.error.code, status);
    }
  }
  return new ApiClientError(`接口请求失败（HTTP ${status}）。`, `HTTP_${status}`, status);
}

/** 上传浏览器选择的原始文件，返回服务端保存的短期引用和真实来源。 */
export async function uploadInspectionImages(
  demandId: string,
  files: readonly File[],
): Promise<InspectionUploadResponse> {
  const form = new FormData();
  form.set("demandId", demandId);
  files.forEach(file => form.append("images", file, file.name));

  let response: Response;
  try {
    response = await fetch("/api/inspect/images", { method: "POST", body: form });
  } catch {
    throw new ApiClientError("网络请求失败。", "NETWORK_ERROR", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(`接口返回不是有效 JSON（HTTP ${response.status}）。`, "INVALID_RESPONSE", response.status);
  }
  if (!response.ok) throw failureFromPayload(payload, response.status);

  const parsed = envelope(InspectionUploadResult).safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(`接口返回格式不符合契约（HTTP ${response.status}）。`, "INVALID_RESPONSE", response.status);
  }
  return { data: parsed.data.data, source: parsed.data.meta.source };
}

export const PHOTO_INSPECTION_HINTS = [
  "照片是否被遮挡或反光影响判断",
  "关键细节是否清晰可见",
  "是否需要补拍更近或不同角度的照片",
] as const;

export function photoInspectionStatus(phase: PhotoInspectionPhase, count: number): string {
  if (phase === "submitting") {
    return "正在提交照片，等待接口返回…";
  }
  if (phase === "ready") {
    return "接口已返回辅助检查结果，请结合现场情况人工复核。";
  }
  if (phase === "unavailable") {
    return "照片检查接口尚未开放（501），当前不会生成分析结论。";
  }
  if (phase === "failed") {
    return "照片检查未完成，请检查错误信息后重试。";
  }
  if (phase === "invalid") {
    return "照片选择不符合要求，请重新选择。";
  }
  if (phase === "selected") {
    return `已选择 ${count} 张照片，提交后等待接口返回。`;
  }
  return "尚未选择照片，来源未确认。";
}

/** 把公共输入契约转换成业主能读懂的选择提示，避免直接展示 Zod 原始错误。 */
export function photoInspectionSelectionError(imageRefs: string[]): string | null {
  const parsed = PhotoInspectionInput.safeParse({ demandId: "selection-check", imageRefs });
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (issue?.path[0] === "imageRefs" && issue.code === "too_big") {
    return "最多选择 10 张照片，请重新选择。";
  }
  if (issue?.path[0] === "imageRefs" && issue.message === "图片引用不能重复") {
    return "照片引用不能重复，请重新选择。";
  }
  return "照片选择不符合要求，请重新选择。";
}

export function inspectionSourceLabel(source: SourceDTO): string {
  return source === "mock" ? "mock（模拟数据）" : "live";
}

export function formatInspectionResult(data: PhotoInspectionResultDTO): string {
  if (typeof data === "string") return data;
  if (data === undefined) return "接口返回了空结果。";
  try {
    return JSON.stringify(data, null, 2) ?? "接口返回了空结果。";
  } catch {
    return "接口返回了无法展示的结果。";
  }
}

/** 通过 D 提供的共享客户端调用照片检查接口，并校验公共输入/输出契约。 */
export function submitPhotoInspection(demandId: string, imageRefs: string[]): Promise<PhotoInspectionResponse> {
  const input = PhotoInspectionInput.parse({ demandId, imageRefs });
  return apiPost("/api/inspect", input, PhotoInspectionResult);
}
