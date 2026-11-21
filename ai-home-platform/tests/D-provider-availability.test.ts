import test from "node:test";
import assert from "node:assert/strict";
import { Provider, ProviderAvailability } from "../src/contracts";
import { demoDemand, providers } from "../src/lib/mock-data";
import { matchProviders } from "../src/lib/match";

test("固定服务方档期使用公共契约并明确 mock 来源", () => {
  assert.equal(providers.length, 6);
  assert.ok(providers.every(provider => provider.availability === null || provider.availability?.source === "mock"));
  assert.equal(providers.find(provider => provider.id === "provider-b")?.availability?.windows[0].startDate, "2026-11-20");
  assert.deepEqual(providers.find(provider => provider.id === "provider-d")?.availability?.windows, []);
  assert.equal(Provider.parse({ ...providers[0], availability: undefined }).id, "provider-a");
});

test("实际运行样例同分且不拼接短窗口，上海 11 月 22 日起不再保证 live 翻转", () => {
  const before = structuredClone(providers);
  const rank = (instant: string) => matchProviders(demoDemand, providers, Date.parse(instant));
  const current = rank("2026-11-15T04:00:00Z");
  assert.deepEqual(current.map(row => [row.provider.id, row.score]), [["provider-b", 98], ["provider-a", 98]]);
  assert.deepEqual(rank("2026-11-21T15:59:59.999Z").map(row => row.provider.id), ["provider-b", "provider-a"]);
  assert.deepEqual(rank("2026-11-21T16:00:00Z").map(row => row.provider.id), ["provider-a", "provider-b"]);
  assert.deepEqual(rank("2027-01-01T00:00:00Z").map(row => row.provider.id), ["provider-a", "provider-b"]);
  assert.deepEqual(providers, before);
});

test("档期契约校验有效日期、覆盖范围、顺序和更新时间", () => {
  const base = {
    coverageStartDate: "2026-11-15",
    coverageEndDate: "2026-12-31",
    windows: [{ startDate: "2026-11-20", endDate: "2026-12-10" }],
    updatedAt: "2026-11-14T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.000Z",
    source: "mock" as const,
  };
  assert.ok(ProviderAvailability.safeParse(base).success);
  assert.ok(ProviderAvailability.safeParse({ ...base, coverageStartDate: "2028-02-28", coverageEndDate: "2028-03-01",
    windows: [{ startDate: "2028-02-29", endDate: "2028-03-01" }] }).success);
  assert.ok(ProviderAvailability.safeParse({ ...base, windows: [
    { startDate: "2026-11-20", endDate: "2026-11-20" }, { startDate: "2026-11-21", endDate: "2026-11-22" },
  ] }).success);
  for (const patch of [
    { coverageStartDate: "2026-02-29" },
    { coverageStartDate: "2026-12-31", coverageEndDate: "2026-11-15" },
    { windows: [{ startDate: "2026-12-11", endDate: "2027-01-01" }] },
    { windows: [{ startDate: "2026-11-25", endDate: "2026-11-30" }, { startDate: "2026-11-28", endDate: "2026-12-01" }] },
    { windows: [{ startDate: "2026-12-10", endDate: "2026-11-20" }] },
    { windows: [{ startDate: "2026-11-20", endDate: "2026-11-22" }, { startDate: "2026-11-22", endDate: "2026-11-23" }] },
    { windows: [{ startDate: "2026-12-10", endDate: "2026-12-11" }, { startDate: "2026-11-20", endDate: "2026-11-21" }] },
    { updatedAt: "2027-01-01T00:00:00.000Z" },
    { source: "unknown" },
  ]) {
    assert.equal(ProviderAvailability.safeParse({ ...base, ...patch }).success, false, JSON.stringify(patch));
  }
  assert.ok(ProviderAvailability.safeParse({ ...base, updatedAt: "2025-12-01T00:00:00.000Z", validUntil: "2026-11-01T00:00:00.000Z" }).success,
    "过期由调用方解释，契约不依赖客户端当前时间");
});
