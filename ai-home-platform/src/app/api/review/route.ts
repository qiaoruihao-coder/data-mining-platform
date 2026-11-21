import { handleReviewCreate, handleReviewRead } from "@/lib/review";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleReviewCreate(request);
}

export function GET(request: Request) {
  return handleReviewRead(request);
}
