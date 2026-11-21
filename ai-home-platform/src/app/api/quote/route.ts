import { handleQuoteRead } from "@/lib/quote-engine/read-request";
import { handleQuoteSubmission } from "@/lib/quote-engine/submit-request";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleQuoteRead(request);
}

export async function POST(request: Request) {
  // 演示会话在预检和事务内分别验证；回执使用报价的持久化来源。
  return handleQuoteSubmission(request);
}
