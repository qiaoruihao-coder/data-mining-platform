import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey, Quote, QuoteSubmissionInput, type QuoteSubmissionInputDTO } from "@/contracts";
import { apiPost, ApiClientError } from "@/lib/api-client";

export async function submitQuote(input: QuoteSubmissionInputDTO, idempotencyKey: string) {
  const parsed = QuoteSubmissionInput.safeParse(input);
  if (!parsed.success) throw new ApiClientError("报价输入不符合公共契约。", "LOCAL_VALIDATION_ERROR", 400);
  const key = IdempotencyKey.safeParse(idempotencyKey);
  if (!key.success) throw new ApiClientError("报价提交标识不符合公共契约。", "LOCAL_INVALID_IDEMPOTENCY_KEY", 400);
  const response = await apiPost("/api/quote", parsed.data, Quote, {
    headers: { [IDEMPOTENCY_KEY_HEADER]: key.data },
  });
  if (response.data.demandId !== parsed.data.demandId || response.data.status !== "submitted") {
    throw new ApiClientError("报价响应与当前提交不一致。", "INVALID_RESPONSE", 200);
  }
  return response;
}

export type QuoteSubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "received"; response: Awaited<ReturnType<typeof submitQuote>> }
  | { status: "rejected"; message: string }
  | { status: "uncertain"; message: string; retryable?: boolean };

export function quoteSubmissionFailure(error: unknown): Extract<QuoteSubmissionState, { message: string }> {
  if (error instanceof ApiClientError) {
    if (error.code === "LOCAL_IDEMPOTENCY_KEY_UNAVAILABLE" || error.code === "LOCAL_INVALID_IDEMPOTENCY_KEY") {
      return { status: "rejected", message: "无法准备本次报价的提交标识，本次未发送请求。请使用支持安全随机数的浏览器环境后再尝试。" };
    }
    if (error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT") {
      return { status: "uncertain", retryable: false, message: "本次提交标识与先前报价内容冲突，已有报价需要核实。请保持此页面并联系平台；本页不会再次提交，也不会换标识重发。" };
    }
    const messages: Partial<Record<number, string>> = {
      400: "报价字段未通过校验，请检查填写内容后重新预览。",
      401: "尚未获得服务方身份授权，请完成身份验证后再提交。角色导航不能代替登录。",
      403: "当前身份无权提交此报价，请先核实服务方权限。",
      404: "关联需求不存在或不可访问，请返回需求大厅确认。",
      409: "需求状态已变化或报价发生冲突，请先刷新需求详情并核实。刷新会丢失本页填写内容。",
      501: "报价提交尚未开放（HTTP 501），本次未提交成功，业主暂时无法查看本次报价。",
      503: "报价服务暂时不可用（HTTP 503），本次提交失败，请稍后重试。",
    };
    const message = messages[error.status];
    if (message) return { status: "rejected", message };
  }
  // 网络中断、服务端异常或无效回执可能发生在写入之后，不能断言未保存或自动重发。
  return { status: "uncertain", retryable: true, message: "未取得可验证的报价回执，提交结果未知。请保持此页面，先联系平台核实，或使用同一标识重试；不会换标识重发。" };
}

/** 重试被拒绝只说明本次请求未成功，不能撤销先前结果未知的事实。 */
export function quoteUncertainRetryFailure(error: unknown): Extract<QuoteSubmissionState, { status: "uncertain" }> {
  const failure = quoteSubmissionFailure(error);
  if (failure.status === "uncertain") return failure;

  const status = error instanceof ApiClientError ? error.status : 0;
  const reasons: Partial<Record<number, string>> = {
    400: "本次重试未通过校验。",
    401: "本次重试未通过服务方身份验证。",
    403: "当前身份无权重试此报价。",
    404: "关联需求不存在或当前不可访问。",
    409: "需求状态已变化或发生冲突，本次未取得历史回执。",
    501: "本次重试接口尚未开放（HTTP 501）。",
    503: "本次重试服务暂时不可用（HTTP 503）。",
  };
  const retryable = status === 401 || status === 503;
  const nextStep = status === 401
    ? "请在保留此页面的情况下完成身份验证，再使用同一标识重试。"
    : status === 503
      ? "服务恢复后可使用同一标识重试。"
      : "请保持此页面并联系平台核实，本页不再提供重试。";
  return {
    status: "uncertain",
    retryable,
    message: `${reasons[status] ?? "本次重试未成功。"}之前的报价仍可能已保存，提交结果仍未知。${nextStep}原填写内容继续锁定，不会换标识重发。`,
  };
}
