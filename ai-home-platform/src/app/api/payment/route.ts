import { PaymentActionInput, type ApiFailure } from "@/contracts";
import { dataResponse } from "@/lib/api-response";
import { confirmDemoPaymentById, listDemoPayments } from "@/lib/payment-state";

export function GET() {
  return dataResponse(listDemoPayments(), "mock");
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({
      ok: false,
      error: { code: "INVALID_JSON", message: "请求不是有效 JSON。" },
    } satisfies ApiFailure, { status: 400 });
  }

  const input = PaymentActionInput.safeParse(json);
  if (!input.success) {
    return Response.json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "付款动作字段不符合契约。" },
    } satisfies ApiFailure, { status: 400 });
  }

  const result = confirmDemoPaymentById(input.data.paymentId);
  if (result.kind === "not_found") {
    return Response.json({
      ok: false,
      error: { code: "PAYMENT_NOT_FOUND", message: "付款节点不存在。" },
    } satisfies ApiFailure, { status: 404 });
  }
  if (result.kind === "already_confirmed") {
    return Response.json({
      ok: false,
      error: { code: "PAYMENT_ALREADY_CONFIRMED", message: "该演示付款节点已确认。" },
    } satisfies ApiFailure, { status: 409 });
  }

  return dataResponse(result.payment, "mock");
}
