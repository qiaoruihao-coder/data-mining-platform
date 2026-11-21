import {
  OwnerOrderResult,
  Review,
  ReviewInput,
  ReviewQuery,
  type OrderSummaryDTO,
  type ReviewDTO,
  type ReviewInputDTO,
} from "@/contracts";
import { ApiClientError, apiGet, apiPost } from "@/lib/api-client";

export type ReviewForm = Pick<ReviewInputDTO, "rating" | "comment">;

export type ReviewListResponse = {
  data: ReviewDTO[];
  source: "mock" | "live";
};

export type OwnerOrderResponse = {
  order: OrderSummaryDTO | null;
  source: "mock" | "live";
};

export type ReviewSubmitOutcome =
  | { kind: "created"; review: ReviewDTO; source: "mock" | "live" }
  | { kind: "confirmed"; review: ReviewDTO; source: "mock" | "live" }
  | { kind: "auth_required"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "uncertain"; message: string; reviews?: ReviewListResponse }
  | { kind: "failed"; message: string };

export function formToReviewInput(demandId: string, providerId: string, form: ReviewForm): ReviewInputDTO {
  return ReviewInput.parse({ demandId, providerId, rating: form.rating, comment: form.comment.trim() });
}

export async function loadOwnerOrder(demandId: string): Promise<OwnerOrderResponse> {
  const result = await apiGet(`/api/order?demandId=${encodeURIComponent(demandId)}`, OwnerOrderResult);
  if (result.data && result.data.demandId !== demandId) {
    throw new ApiClientError("接口返回了另一条需求的接单。", "INVALID_RESPONSE", 200);
  }
  return { order: result.data, source: result.meta.source };
}

export async function loadReviews(demandId: string): Promise<ReviewListResponse> {
  const query = ReviewQuery.parse({ demandId });
  const result = await apiGet(`/api/review?demandId=${encodeURIComponent(query.demandId)}`, Review.array());
  if (result.data.some((review) => review.demandId !== demandId)) {
    throw new ApiClientError("接口返回了其他需求的评价。", "INVALID_RESPONSE", 200);
  }
  return { data: result.data, source: result.meta.source };
}

export async function createReview(demandId: string, providerId: string, form: ReviewForm) {
  const input = formToReviewInput(demandId, providerId, form);
  const result = await apiPost("/api/review", input, Review);
  return { review: result.data, source: result.source };
}

export function isReviewAccessDenied(error: unknown): boolean {
  return error instanceof ApiClientError && [401, 403, 404].includes(error.status);
}

function isUncertainReviewError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 503 || error.status === 0 || error.code === "NETWORK_ERROR");
}

export function reviewErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "评价服务暂时不可用，请稍后重试。";
  if (error.status === 401) return "请先完成业主登录，评价表单内容会保留。";
  if (error.status === 403) return "当前账号没有提交这条需求评价的权限。";
  if (error.status === 404) return "未找到这条需求或评价对象，无法提交。";
  if (error.status === 409) {
    if (error.code === "DEMO_DEMAND_READ_ONLY") return "模拟需求只供查看，不能提交评价。";
    if (error.code === "REVIEW_ALREADY_EXISTS") return "这笔接单已有不同内容的评价，不能覆盖。";
    if (error.code === "REVIEW_PROVIDER_MISMATCH") return "评价对象已变化，请重新读取接单信息。";
    return "当前需求或接单状态还不满足评价条件，请刷新核实。";
  }
  if (error.status === 501) return "评价接口尚未开放（HTTP 501），本次没有当作成功。";
  if (error.status === 503 || error.status === 0 || error.code === "NETWORK_ERROR") {
    return "暂时无法确认评价结果，请先重新读取评价后再决定是否重试。";
  }
  return `${error.message}（${error.code}）`;
}

async function reconcileReview(demandId: string): Promise<ReviewListResponse | null> {
  try { return await loadReviews(demandId); } catch { return null; }
}

export async function submitReview(demandId: string, providerId: string, form: ReviewForm): Promise<ReviewSubmitOutcome> {
  try {
    const result = await createReview(demandId, providerId, form);
    return { kind: "created", ...result };
  } catch (error) {
    if (isUncertainReviewError(error) || (error instanceof ApiClientError && error.status === 409 && error.code === "REVIEW_ALREADY_EXISTS")) {
      const reviews = await reconcileReview(demandId);
      if (reviews?.data[0]) return { kind: "confirmed", review: reviews.data[0], source: reviews.source };
      if (isUncertainReviewError(error)) return { kind: "uncertain", message: reviewErrorMessage(error), reviews: reviews ?? undefined };
    }
    if (error instanceof ApiClientError) {
      if (error.status === 401) return { kind: "auth_required", message: reviewErrorMessage(error) };
      if (error.status === 403) return { kind: "forbidden", message: reviewErrorMessage(error) };
      if (error.status === 404) return { kind: "not_found", message: reviewErrorMessage(error) };
      if (error.status === 409) return { kind: "conflict", message: reviewErrorMessage(error) };
    }
    return { kind: "failed", message: reviewErrorMessage(error) };
  }
}

export function reviewSourceLabel(source: "mock" | "live"): string {
  return source === "mock" ? "模拟数据（mock）" : "实时接口（live）";
}
