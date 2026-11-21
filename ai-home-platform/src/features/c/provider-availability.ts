import type { ProviderDTO } from "@/contracts";

// Input has already passed the shared Provider schema in the directory loader.
export function providerAvailabilityStatus(availability: ProviderDTO["availability"], now: number | null) {
  if (availability == null) return "unknown";
  if (now === null || !Number.isFinite(now)) return "checking";
  if (now >= Date.parse(availability.validUntil)) return "expired";
  return availability.windows.length === 0 ? "empty" : "recorded";
}
