import { z } from "zod";
import { ChatResult, Demand, DemandInput, envelope } from "@/contracts";
import type { ChatInputDTO, ChatResultDTO, DemandDTO, DemandInputDTO } from "@/contracts";
import { ApiClientError, apiPost } from "@/lib/api-client";

/** 对话与提交逻辑：复用公共契约和请求客户端，不依赖 React。 */

export type DemandDraftInput = DemandInputDTO;

export type ChatMessage = ChatInputDTO["messages"][number];
export type ChatRole = ChatMessage["role"];
const chatEnvelope = envelope(ChatResult);
export type EnvelopeSource = z.infer<typeof chatEnvelope>["meta"]["source"];

/** 将接口来源转换成业主可理解的文案，避免把内部枚举直接展示在页面上。 */
export function sourceLabel(source: EnvelopeSource | null): string {
  if (source === "mock") return "模拟结果";
  if (source === "live") return "实时结果";
  return "尚未确认";
}

/** 与 ChatInput 契约一致：单条 4000 字、最多 30 条 */
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGES = 30;

export const FIELD_LABELS: Record<string, string> = {
  description: "需求描述",
  city: "城市",
  areaM2: "面积",
  budgetMinCents: "预算下限",
  budgetMaxCents: "预算上限",
  renovationType: "改造类型",
  desiredDays: "期望工期",
};

export const RENOVATION_OPTIONS = [
  { value: "elderly", label: "适老化改造" },
  { value: "partial", label: "局部改造" },
  { value: "repair", label: "维修" },
] as const;

export type RenovationType = DemandInputDTO["renovationType"];

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function renovationLabel(value: string): string {
  return RENOVATION_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

/** 发送前的本地校验，避免把空消息或超长消息丢给接口再等一个 400 */
export function normalizeOutgoing(
  text: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = text.trim();
  if (!value) return { ok: false, message: "请先描述一下房子的情况和您想怎么改。" };
  if (value.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, message: `单条消息不能超过 ${MAX_MESSAGE_LENGTH} 字，请拆成几段说。` };
  }
  return { ok: true, value };
}

/** 追加消息并裁剪到契约允许的条数，保证请求体始终能被 ChatInput 接受 */
export function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...messages, message];
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}

/** 只保留契约允许的字段，避免把界面状态一起发给接口 */
export function toChatPayload(messages: ChatMessage[]): ChatInputDTO {
  return {
    messages: messages
      .filter((m) => m.content.trim().length > 0)
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) })),
  };
}

export type ApiError = { code: string; message: string; notImplemented: boolean };

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

export function describeFailure(status: number, payload: unknown): ApiError {
  const parsed = failureSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message } = parsed.data.error;
    return { code, message, notImplemented: code === "NOT_IMPLEMENTED" || status === 501 };
  }
  return {
    code: `HTTP_${status}`,
    message: "服务暂时无法完成保存，请稍后重试。",
    notImplemented: status === 501,
  };
}

/** 校验对话响应：缺 meta.source 或字段不符都按失败处理，不猜测 */
export function parseChatResponse(payload: unknown): { data: ChatResultDTO; source: EnvelopeSource } {
  const parsed = chatEnvelope.safeParse(payload);
  if (!parsed.success) throw new Error("需求助手暂时无法整理这次对话，请重试。");
  return { data: parsed.data.data, source: parsed.data.meta.source };
}

export type DemandForm = {
  description: string;
  city: string;
  areaM2: string;
  budgetMinYuan: string;
  budgetMaxYuan: string;
  renovationType: RenovationType;
  desiredDays: string;
};

export const EMPTY_FORM: DemandForm = {
  description: "",
  city: "",
  areaM2: "",
  budgetMinYuan: "",
  budgetMaxYuan: "",
  renovationType: "elderly",
  desiredDays: "",
};

/** 元 → 分：只接受非负、最多两位小数，且必须是安全整数 */
export function yuanToCents(yuan: string): number | null {
  const trimmed = yuan.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [integer, decimal = ""] = trimmed.split(".");
  const cents = Number(integer) * 100 + Number((decimal + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** 把接口返回的草稿映射成可编辑表单；草稿为 null 时给出空表单，不虚构数值 */
export function formFromDraft(draft: DemandDraftInput | null): DemandForm {
  if (!draft) return { ...EMPTY_FORM };
  return {
    description: draft.description,
    city: draft.city,
    areaM2: String(draft.areaM2),
    budgetMinYuan: centsToYuan(draft.budgetMinCents),
    budgetMaxYuan: centsToYuan(draft.budgetMaxCents),
    renovationType: draft.renovationType,
    desiredDays: String(draft.desiredDays),
  };
}

export type FormCheck =
  | { ok: true; value: DemandDraftInput }
  | { ok: false; messages: string[] };

/** 表单 → DemandInput：先在本地按契约校验，错误提示用中文字段名 */
export function formToInput(form: DemandForm): FormCheck {
  const messages: string[] = [];
  const areaM2 = Number(form.areaM2);
  const desiredDays = Number(form.desiredDays);
  const budgetMinCents = yuanToCents(form.budgetMinYuan);
  const budgetMaxCents = yuanToCents(form.budgetMaxYuan);

  if (!form.description.trim()) messages.push("需求描述：请用一两句话说明要改什么。");
  if (!form.city.trim()) messages.push("城市：请填写所在城市。");
  if (!Number.isFinite(areaM2) || areaM2 <= 0) messages.push("面积：请填写大于 0 的数字（㎡）。");
  if (budgetMinCents === null) messages.push("预算下限：请填写非负金额，最多两位小数（元）。");
  if (budgetMaxCents === null) messages.push("预算上限：请填写非负金额，最多两位小数（元）。");
  if (!Number.isInteger(desiredDays) || desiredDays <= 0) {
    messages.push("期望工期：请填写大于 0 的整数天数。");
  }
  if (messages.length) return { ok: false, messages };

  const candidate = {
    description: form.description.trim(),
    city: form.city.trim(),
    areaM2,
    budgetMinCents: budgetMinCents as number,
    budgetMaxCents: budgetMaxCents as number,
    renovationType: form.renovationType,
    desiredDays,
  };
  const parsed = DemandInput.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      messages: parsed.error.issues.map(
        (issue) => `${fieldLabel(String(issue.path[0] ?? ""))}：${issue.message}`,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

export type SubmitOutcome =
  | { kind: "created"; demand: DemandDTO; source: EnvelopeSource }
  | { kind: "not_implemented"; message: string }
  | { kind: "auth_required"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "rejected"; messages: string[] }
  | { kind: "failed"; message: string };

/** 提交结果只认契约里的成功信封；501 必须落成“未开放”，不能当成功 */
export function interpretDemandSubmit(status: number, payload: unknown): SubmitOutcome {
  const success = envelope(Demand).safeParse(payload);
  if (status >= 200 && status < 300 && success.success) {
    return { kind: "created", demand: success.data.data, source: success.data.meta.source };
  }
  const error = describeFailure(status, payload);
  if (error.notImplemented) {
    return {
      kind: "not_implemented",
      message: "当前暂时无法保存需求，请稍后重试。",
    };
  }
  if (status === 401 || error.code === "UNAUTHENTICATED") {
    return {
      kind: "auth_required",
      message: "请点击页面顶部的“业主登录”，完成登录后再保存本人需求；本次填写的内容仍保留在表单中。",
    };
  }
  if (status === 403 || error.code === "FORBIDDEN") {
    return {
      kind: "forbidden",
      message: "当前请求没有需求创建权限，请确认使用当前站点并完成业主登录；本次填写的内容仍保留在表单中。",
    };
  }
  if (error.code === "VALIDATION_ERROR") {
    return { kind: "rejected", messages: [error.message] };
  }
  return { kind: "failed", message: error.message };
}

export function demandPath(id: string): string {
  return `/owner/demand/${encodeURIComponent(id)}`;
}

/** 使用 D 的请求客户端；只有通过公共契约校验的成功响应才能产生详情链接。 */
export async function submitDemand(form: DemandForm): Promise<SubmitOutcome> {
  const checked = formToInput(form);
  if (!checked.ok) return { kind: "rejected", messages: checked.messages };
  try {
    const result = await apiPost("/api/demand", checked.value, Demand);
    return { kind: "created", demand: result.data, source: result.source };
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      return interpretDemandSubmit(cause.status, {
        ok: false,
        error: { code: cause.code, message: cause.message },
      });
    }
    return { kind: "failed", message: "未收到有效的保存结果，请先到需求列表核实，再决定是否重试。" };
  }
}
