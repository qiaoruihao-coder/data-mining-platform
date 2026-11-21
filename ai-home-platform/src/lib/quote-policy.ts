import {
  type DemandDTO,
  type ProviderIdentityDTO,
  type UserRoleDTO,
  type VerifiedSessionDTO,
} from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
// B 复用既有服务端入口；来源工具不提供身份验证或权限绕过。
export { parseStoredQuoteSource, summarizeQuoteSources } from "@/lib/quote-source";

export type ProviderAccountBinding = {
  role: UserRoleDTO | null;
  providerId: string | null;
  providerExists: boolean;
};

export type QuoteAuthorizationFailure = {
  ok: false;
  status: 403 | 409;
  code: "FORBIDDEN" | "DEMO_DEMAND_READ_ONLY" | "INVALID_STATE";
  message: string;
};

export type QuoteAuthorizationResult =
  | { ok: true; identity: ProviderIdentityDTO }
  | QuoteAuthorizationFailure;

/**
 * 事务内使用：会话声明、账户记录和服务方记录必须同时匹配。
 * 角色导航、请求体 providerId 和预检快照都不能替代这里的数据库复核。
 */
export function authorizeProviderAccount(
  session: VerifiedSessionDTO,
  binding: ProviderAccountBinding,
): QuoteAuthorizationResult {
  if (
    session.role !== "provider" ||
    session.providerId === null ||
    binding.role !== "provider" ||
    binding.providerId !== session.providerId ||
    !binding.providerExists
  ) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "当前账户未绑定可用的服务方报价身份。",
    };
  }
  return {
    ok: true,
    identity: {
      userId: session.userId,
      role: "provider",
      providerId: session.providerId,
    },
  };
}

/**
 * 当前授权规则：已验证且已绑定的服务方可以给 live、published、非演示需求报价。
 * 现有数据没有服务区域关系，因此城市匹配仍是推荐排序条件，不作为写入授权条件。
 */
export function authorizeProviderQuote(
  identity: ProviderIdentityDTO,
  demand: DemandDTO,
): QuoteAuthorizationResult {
  if (demand.id === DEMO_DEMAND_ID || demand.source !== "live") {
    return {
      ok: false,
      status: 409,
      code: "DEMO_DEMAND_READ_ONLY",
      message: "模拟需求不能接收真实报价。",
    };
  }
  if (demand.status !== "published") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_STATE",
      message: "只有已发布且未签约的需求可以提交报价。",
    };
  }
  return { ok: true, identity };
}
