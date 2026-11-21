import test from "node:test";
import assert from "node:assert/strict";
import { Provider, type ProviderPerformanceDTO } from "../src/contracts";
import { matchProviders } from "../src/lib/match";
import { assessAvailability } from "../src/lib/match/availability";
import { MATCH_FIXTURE_NOW, matchDemandFixture } from "./B-match-fixtures";

// D 已采纳但尚未替换的样例方案，独立合成；不读取或修改运行时 providers。
function candidates(source: ProviderPerformanceDTO["source"]) {
  const availability = {
    coverageStartDate: "2026-11-15", coverageEndDate: "2026-12-31",
    updatedAt: "2026-11-14T00:00:00Z", validUntil: "2026-12-31T23:59:59Z", source: "mock",
  };
  return Provider.array().parse([
    { id: "a", name: "合成高评价短窗口", city: "深圳", kind: "construction", tags: ["适老化"], rating: 4.8, source: "mock",
      availability: { ...availability, windows: [{ startDate: "2026-11-18", endDate: "2026-11-30" }, { startDate: "2026-12-05", endDate: "2026-12-20" }] },
      performance: { basis: "completed_order_review_average", averageRating: source === "mock" ? 4.67 : null, reviewCount: source === "mock" ? 3 : 0, source, calculatedAt: "2026-11-15T04:00:00Z" } },
    { id: "b", name: "合成低评价长窗口", city: "深圳", kind: "construction", tags: ["适老化"], rating: 4.8, source: "mock",
      availability: { ...availability, windows: [{ startDate: "2026-11-20", endDate: "2026-12-20" }] },
      performance: { basis: "completed_order_review_average", averageRating: source === "mock" ? 4 : null, reviewCount: source === "mock" ? 1 : 0, source, calculatedAt: "2026-11-15T04:00:00Z" } },
  ]);
}

test("同分方案在固定有效时点：live 无样本按档期 b→a，mock 按评价 a→b", () => {
  for (const source of ["live", "mock"] as const) {
    const rows = candidates(source);
    const before = structuredClone(rows);
    for (const input of [rows, [...rows].reverse()]) {
      const result = matchProviders(matchDemandFixture, input, MATCH_FIXTURE_NOW);
      assert.deepEqual(result.map(row => row.provider.id), source === "live" ? ["b", "a"] : ["a", "b"]);
      assert.deepEqual(result.map(row => row.score), [98, 98]);
      assert.ok(result.every(row => row.provider.performance?.source === source && row.provider.availability?.source === "mock"));
      assert.ok(result.every(row => row.reasons.some(reason => reason.includes("档期在读取时有效且来源一致"))));
      assert.ok(result.every(row => row.reasons.some(reason => reason.includes(source === "live" ? "整组不使用评价" : "评价数据完整且来源一致"))));
    }
    assert.deepEqual(rows, before);
  }
});

test("11 月 21 日剩余 30 天仍 b→a，上海 22 日零点剩余 29 天改为 ID 顺序", () => {
  const rows = candidates("live");
  const beforeMidnight = Date.parse("2026-11-21T15:59:59.999Z");
  const midnight = beforeMidnight + 1;
  assert.equal(assessAvailability(rows[1].availability, 30, beforeMidnight).remaining[0].days, 30);
  assert.deepEqual(matchProviders(matchDemandFixture, rows, beforeMidnight).map(row => row.provider.id), ["b", "a"]);
  const after = assessAvailability(rows[1].availability, 30, midnight);
  assert.equal(after.remaining[0].days, 29);
  assert.equal(after.status, "insufficient");
  assert.deepEqual(matchProviders(matchDemandFixture, rows, midnight).map(row => row.provider.id), ["a", "b"]);
});

test("到期后整组不使用档期，live 按 ID，mock 仍遵循评价，未知不淘汰", () => {
  const expiry = Date.parse("2026-12-31T23:59:59Z");
  for (const source of ["live", "mock"] as const) {
    const rows = candidates(source);
    assert.ok(rows.every(row => assessAvailability(row.availability, 30, expiry).status === "expired"));
    const result = matchProviders(matchDemandFixture, rows, expiry);
    assert.deepEqual(result.map(row => row.provider.id), ["a", "b"]);
    assert.ok(result.every(row => row.reasons.some(reason => reason.includes("整组不使用档期细排"))));
  }
  const rows = candidates("live");
  rows[0].availability = null;
  assert.deepEqual(matchProviders(matchDemandFixture, rows, MATCH_FIXTURE_NOW).map(row => row.provider.id), ["a", "b"]);
});
