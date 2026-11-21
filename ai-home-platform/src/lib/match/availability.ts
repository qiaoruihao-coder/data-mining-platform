import { ProviderAvailability, type ProviderDTO } from "@/contracts";

const DAY_MS = 86_400_000;
const shanghaiDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function shanghaiDay(now: number): string {
  const parts = shanghaiDate.formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 只判断读取时点的单段剩余窗口；不拼接窗口，不代表预约或工期承诺。 */
export function assessAvailability(value: ProviderDTO["availability"], desiredDays: number, now: number) {
  const parsed = ProviderAvailability.safeParse(value);
  if (!parsed.success) return { status: "unknown" as const, data: null, remaining: [], fits: null };
  const data = parsed.data;
  if (!Number.isFinite(now) || !Number.isInteger(desiredDays) || desiredDays <= 0 || now < Date.parse(data.updatedAt)) {
    return { status: "unknown" as const, data, remaining: [], fits: null };
  }
  const today = shanghaiDay(now);
  if (now >= Date.parse(data.validUntil) || today > data.coverageEndDate) {
    return { status: "expired" as const, data, remaining: [], fits: null };
  }
  const remaining = data.windows.filter(window => window.endDate >= today).map(window => {
    const startDate = window.startDate < today ? today : window.startDate;
    const days = (Date.parse(`${window.endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS + 1;
    return { startDate, endDate: window.endDate, days };
  });
  const fits = remaining.some(window => window.days >= desiredDays);
  return { status: fits ? "fits" as const : remaining.length ? "insufficient" as const : "empty" as const, data, remaining, fits };
}
