import { Money, Quote, QuoteItem, QuoteSubmissionInput, QuoteSubmissionItemInput, type QuoteDTO, type QuoteSubmissionInputDTO } from "@/contracts";

// 仅为输入框状态；提交时转换为公共 QuoteSubmissionInputDTO。
export type QuoteLineFields = {
  code: string;
  name: string;
  unit: QuoteDTO["items"][number]["unit"];
  quantity: string;
  priceYuan: string;
  pending: boolean;
  note: string;
};
export type QuoteFormFields = { lines: QuoteLineFields[]; estimatedDays: string };
export type QuotePreviewData = Pick<QuoteDTO, "items" | "estimatedDays" | "knownTotalCents" | "pendingItems">;
export type QuoteFormResult =
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "preview"; preview: QuotePreviewData };

export const MAX_QUOTE_LINES = 20;
export const quoteUnitLabels: Record<QuoteLineFields["unit"], string> = {
  m2: "平方米", piece: "件", job: "项",
};
const maxInteger = BigInt(Number.MAX_SAFE_INTEGER);
const previewSchema = Quote.pick({ items: true, estimatedDays: true, knownTotalCents: true, pendingItems: true });

export function emptyQuoteLine(sequence: number): QuoteLineFields {
  return { code: `line-${sequence}`, name: "", unit: "job", quantity: "", priceYuan: "", pending: false, note: "" };
}

// 字符串转分，不用 parseFloat 或浮点乘法；空白与待确认由表单明确区分。
export function quotePriceToCents(value: string): number | null {
  const text = value.trim();
  if (text.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= maxInteger ? Money.parse(Number(cents)) : null;
}

function quantityInThousandths(value: string): bigint | null {
  const text = value.trim();
  if (text.length > 32 || !/^\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (scaled <= 0n || scaled > maxInteger) return null;
  if (!QuoteSubmissionItemInput.shape.quantity.safeParse(Number(scaled) / 1000).success) return null;
  // 公共契约数量是 number；拒绝转换后已丢失输入小数位的极大数量。
  const [numericWhole, numericFraction = ""] = (Number(scaled) / 1000).toString().split(".");
  if (BigInt(numericWhole) * 1000n + BigInt(numericFraction.padEnd(3, "0")) !== scaled) return null;
  return scaled;
}

// 保持 Money 上界处的末位分精度；仅接收通过公共校验的金额。
export function formatQuoteMoney(cents: number) {
  const value = BigInt(Money.parse(cents));
  return `¥${(value / 100n).toLocaleString("zh-CN")}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function validateQuoteForm(fields: QuoteFormFields): QuoteFormResult {
  const errors: Record<string, string> = {};
  if (fields.lines.length === 0 || fields.lines.length > MAX_QUOTE_LINES) {
    errors.lines = `请填写 1–${MAX_QUOTE_LINES} 个报价项目。`;
  }
  const days = fields.estimatedDays.trim();
  const dayResult = QuoteSubmissionInput.innerType().shape.estimatedDays.safeParse(Number(days));
  if (!/^\d+$/.test(days) || !dayResult.success || !Number.isSafeInteger(Number(days))) {
    errors.estimatedDays = "预计工期须为大于 0 的安全整数天数。";
  }
  const items: QuoteDTO["items"] = [];
  const codes = new Set<string>();
  let total = 0n;

  fields.lines.forEach((line) => {
    const codeResult = QuoteSubmissionItemInput.shape.code.safeParse(line.code);
    if (!codeResult.success || codes.has(codeResult.data)) {
      errors.lines = "项目编号异常，请重新添加该项目。";
    }
    if (codeResult.success) codes.add(codeResult.data);
    const key = (field: string) => `${line.code}-${field}`;
    const name = line.name.trim();
    const note = line.note.trim();
    if (!QuoteSubmissionItemInput.shape.name.safeParse(name).success) errors[key("name")] = "项目名称须为 1–100 字。";
    if (!QuoteSubmissionItemInput.shape.note.safeParse(note).success) errors[key("note")] = "备注不能超过 1000 字。";
    if (line.pending && !note) errors[key("note")] = "请说明费用待确认的原因。";
    if (!QuoteSubmissionItemInput.shape.unit.safeParse(line.unit).success) errors[key("unit")] = "请选择有效的计价单位。";
    const scaled = quantityInThousandths(line.quantity);
    if (scaled === null) errors[key("quantity")] = "数量须大于 0 且不超过 1,000,000，最多三位小数。";
    const price = line.pending ? null : quotePriceToCents(line.priceYuan);
    if (!line.pending && price === null) errors[key("priceYuan")] = "请输入非负单价（元），最多两位小数；未知费用请勾选待确认。";

    // 使用 D/B 已冻结的整数计价规则，最终提交结果仍以服务端返回为准。
    const amount = scaled !== null && price !== null ? (scaled * BigInt(price) + 500n) / 1000n : null;
    if (amount !== null && amount > maxInteger) errors[key("priceYuan")] = "该项目金额超出安全范围，请调整数量或单价。";
    if (amount !== null) total += amount;
    if (scaled === null || (amount !== null && amount > maxInteger)) return;
    const item = QuoteItem.safeParse({
      code: codeResult.success ? codeResult.data : line.code, name, unit: line.unit, quantity: Number(scaled) / 1000,
      unitPriceCents: price, amountCents: amount === null ? null : Number(amount), note,
    });
    if (item.success) items.push(item.data);
  });

  if (total > maxInteger) errors.lines = "已知金额小计超出安全范围，请调整明细。";
  if (Object.keys(errors).length > 0) return { kind: "invalid", errors };
  return {
    kind: "preview",
    preview: previewSchema.parse({
      items, estimatedDays: Number(days), knownTotalCents: Number(total),
      pendingItems: items.filter((item) => item.amountCents === null).map((item) => item.name),
    }),
  };
}

export function quoteSubmissionInput(demandId: QuoteSubmissionInputDTO["demandId"], preview: QuotePreviewData): QuoteSubmissionInputDTO {
  return QuoteSubmissionInput.parse({
    demandId,
    items: preview.items.map(({ code, name, unit, quantity, unitPriceCents, note }) => ({
      code, name, unit, quantity, unitPriceCents, note,
    })),
    estimatedDays: preview.estimatedDays,
  });
}
