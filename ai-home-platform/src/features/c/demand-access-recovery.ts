import { OwnerSessionState } from "@/contracts";
import { apiDelete, ApiClientError } from "@/lib/api-client";

/** These errors concern the owner credential, even on the provider's public demand pages. */
export function demandAccessFailure(error: unknown) {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 401) return {
    message: "业主登录已失效，当前需求未能读取。可在页面上方重新登录业主后点击“重新加载”，或退出业主会话后浏览公开需求。服务方登录和角色导航不能解除此问题。",
    canExitOwnerSession: error.code === "UNAUTHENTICATED",
  };
  if (error.status === 403) return {
    message: "当前身份无法查看需求，业主账号权限可能已变更。可退出业主会话后浏览公开需求；如需以业主身份访问，请联系维护者核实账号权限。",
    canExitOwnerSession: error.code === "FORBIDDEN",
  };
  return null;
}

/** Explicit user action only; never clear cookies or fall back to public reads locally. */
export async function exitDemandOwnerSession() {
  const response = await apiDelete("/api/auth/owner", OwnerSessionState);
  if (response.source !== "live" || response.data.status !== "signed_out") {
    throw new ApiClientError("退出业主会话的响应不符合约定。", "INVALID_RESPONSE", 200);
  }
}

export function demandRecoveryErrorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 501) {
    return "退出业主会话接口尚未实现，无法确认已退出；本页未自动刷新。";
  }
  if (error instanceof ApiClientError && error.status === 403) {
    return "退出请求未获允许，无法确认已退出。请从本站的安全连接重试（本地开发可用 localhost）。";
  }
  return "暂时无法确认业主会话是否已退出，本页未自动刷新。请稍后重试；不要把此提示视为退出成功。";
}
