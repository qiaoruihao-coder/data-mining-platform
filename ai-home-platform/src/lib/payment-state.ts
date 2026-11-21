import type { PaymentDTO } from "@/contracts";
import { payments } from "@/lib/mock-data";

/** D：仅模拟付款状态；严禁对外宣称真实资金托管。 */
export function confirmDemoPayment(status: PaymentDTO["status"]): "confirmed_demo" {
  if (status !== "pending") throw new Error("该演示节点已确认");
  return "confirmed_demo";
}

const demoPayments: PaymentDTO[] = payments.map((payment) => ({ ...payment }));

export function listDemoPayments(): PaymentDTO[] {
  return demoPayments.map((payment) => ({ ...payment }));
}

export function confirmDemoPaymentById(paymentId: string):
  | { kind: "not_found" }
  | { kind: "already_confirmed" }
  | { kind: "confirmed"; payment: PaymentDTO } {
  const payment = demoPayments.find((item) => item.id === paymentId);
  if (!payment) return { kind: "not_found" };
  try {
    payment.status = confirmDemoPayment(payment.status);
  } catch {
    return { kind: "already_confirmed" };
  }
  return { kind: "confirmed", payment: { ...payment } };
}
