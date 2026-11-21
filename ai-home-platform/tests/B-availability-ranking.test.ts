import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderAvailabilityDTO, ProviderDTO } from "../src/contracts";
import { demoDemand } from "../src/lib/mock-data";
import { assessAvailability, shanghaiDay } from "../src/lib/match/availability";
import { matchProviders } from "../src/lib/match";
import { MatchResults } from "../src/features/b/MatchResults";
import { loadMatches } from "../src/features/b/load-matches";

// 合成契约夹具，时间固定；不代表真实服务方产能，不写入数据库。
const now = Date.parse("2028-02-28T16:00:00Z"); // 上海闰年 2 月 29 日零时。
const availability = (windows: ProviderAvailabilityDTO["windows"] = [{ startDate: "2028-02-28", endDate: "2028-03-02" }], extra: Partial<ProviderAvailabilityDTO> = {}): ProviderAvailabilityDTO => ({
  windows, coverageStartDate: "2028-02-01", coverageEndDate: "2028-03-31",
  updatedAt: "2028-02-01T00:00:00Z", validUntil: "2028-03-31T16:00:00Z", source: "mock", ...extra,
});
const provider = (id: string, value: ProviderDTO["availability"], extra: Partial<ProviderDTO> = {}): ProviderDTO => ({
  id, name: id, kind: "construction", city: demoDemand.city, rating: 4.5, tags: ["适老化"], source: "mock", availability: value, ...extra,
});
const demand = { ...demoDemand, desiredDays: 3 };
const rank = (rows: ProviderDTO[]) => matchProviders(demand, rows, now).map(row => row.provider.id);
const performance = (averageRating: number) => ({ basis: "completed_order_review_average" as const, averageRating, reviewCount: 3, source: "live" as const, calculatedAt: "2028-02-28T00:00:00Z" });

test("上海零点截断、闰日和跨月按自然日含首尾，不受主机时区影响", () => {
  assert.equal(shanghaiDay(now - 1), "2028-02-28");
  assert.equal(shanghaiDay(now), "2028-02-29");
  const result = assessAvailability(availability(), 3, now);
  assert.equal(result.status, "fits");
  assert.deepEqual(result.remaining, [{ startDate: "2028-02-29", endDate: "2028-03-02", days: 3 }]);
  assert.equal(assessAvailability(availability(), 4, now - 1).fits, true);
  assert.equal(assessAvailability(availability(), 4, now).status, "insufficient");
});

test("跨年窗口和当日一天可用，前一天已结束窗口不计入剩余", () => {
  const value = availability([{ startDate: "2028-12-31", endDate: "2029-01-01" }], {
    coverageStartDate: "2028-12-01", coverageEndDate: "2029-01-31", validUntil: "2029-02-01T00:00:00Z",
  });
  assert.equal(assessAvailability(value, 2, Date.parse("2028-12-30T16:00:00Z")).fits, true);
  assert.equal(assessAvailability(value, 1, Date.parse("2029-01-01T15:59:59Z")).fits, true);
  assert.equal(assessAvailability(value, 1, Date.parse("2029-01-01T16:00:00Z")).status, "empty");
});

test("不累计不相连或相邻的单独窗口", () => {
  for (const startDate of ["2028-03-02", "2028-03-03"]) {
    const value = availability([{ startDate: "2028-02-29", endDate: "2028-03-01" }, { startDate, endDate: "2028-03-04" }]);
    assert.equal(assessAvailability(value, 4, now).status, "insufficient");
  }
});

test("缺省/null/缺来源/非法日期均未知，已确认空窗口与天数不足不同", () => {
  for (const value of [undefined, null, { ...availability(), source: undefined }, availability([{ startDate: "2028-02-30", endDate: "2028-03-02" }])]) {
    const result = assessAvailability(value as ProviderDTO["availability"], 3, now);
    assert.equal(result.status, "unknown");
    assert.equal(result.fits, null);
  }
  assert.equal(assessAvailability(availability([]), 3, now).status, "empty");
  assert.equal(assessAvailability(availability(), 4, now).status, "insufficient");
});

test("有效期到点即失效、覆盖范围过期、未来更新时间与无效读取时钟不参与排序", () => {
  const value = availability(undefined, { validUntil: new Date(now + 1).toISOString() });
  assert.equal(assessAvailability(value, 3, now).fits, true);
  assert.equal(assessAvailability(value, 3, now + 1).status, "expired");
  assert.equal(assessAvailability(value, 3, now + 2).fits, null);
  assert.equal(assessAvailability(availability([], { coverageEndDate: "2028-02-28" }), 3, now).status, "expired");
  assert.equal(assessAvailability(availability(undefined, { updatedAt: new Date(now + 1).toISOString() }), 3, now).status, "unknown");
  assert.equal(assessAvailability(availability(), 3, NaN).status, "unknown");
});

test("档期仅细排同基础分同序候选，不覆盖基础分或有效评价；不按更长窗口加分", () => {
  assert.deepEqual(rank([provider("a", availability([])), provider("b", availability())]), ["b", "a"]);
  assert.deepEqual(rank([provider("a", availability([]), { rating: 5 }), provider("b", availability())]), ["a", "b"]);
  assert.deepEqual(rank([provider("a", availability([]), { performance: performance(5) }), provider("b", availability(), { performance: performance(4) })]), ["a", "b"]);
  assert.deepEqual(rank([provider("a", availability([]), { performance: performance(4) }), provider("b", availability(), { performance: performance(4) })]), ["b", "a"]);
  assert.deepEqual(rank([provider("b", availability([{ startDate: "2028-03-01", endDate: "2028-03-31" }])), provider("a", availability())]), ["a", "b"]);
  assert.deepEqual(matchProviders(demand, [provider("b", availability()), provider("a", availability([]))], now).map(row => row.score), [96, 96]);
});

test("任一档期未知/过期/混合来源使整基础分组跳过档期，但保留评价排序", () => {
  for (const missing of [null, undefined, availability(undefined, { validUntil: new Date(now).toISOString() }), availability(undefined, { source: "live" })]) {
    const rows = [provider("c", availability()), provider("b", missing), provider("a", availability([]))];
    assert.deepEqual(rank(rows), ["a", "b", "c"]);
    assert.ok(matchProviders(demand, rows, now).every(row => row.reasons.some(reason => reason.includes("整组不使用档期细排"))));
    assert.deepEqual(rank(rows.map((row, index) => ({ ...row, performance: performance(5 - index) }))), ["c", "b", "a"]);
  }
});

test("档期同源 live 可细排，异地/错误工种/不同基础分的未知档期不干扰", () => {
  const live = (windows: ProviderAvailabilityDTO["windows"]) => availability(windows, { source: "live" });
  assert.deepEqual(rank([provider("a", live([])), provider("b", live(availability().windows)),
    provider("c", null, { rating: 4 }), provider("d", null, { city: "异地" }), provider("e", null, { kind: "design" })]), ["b", "a", "c"]);
});

function permutations<T>(rows: T[]): T[][] {
  return rows.length ? rows.flatMap((row, index) => permutations(rows.filter((_, i) => i !== index)).map(rest => [row, ...rest])) : [[]];
}
test("全部输入排列均稳定、组合规则无循环比较且输入不变", () => {
  for (const middle of [null, availability(), availability(undefined, { source: "live" })]) {
    const rows = [provider("a", availability([]), { performance: performance(4) }), provider("b", middle, { performance: performance(5) }), provider("c", availability(), { performance: performance(4) }), provider("d", availability([]), { performance: performance(4) })];
    const before = structuredClone(rows);
    const expected = rank(rows);
    for (const permutation of permutations(rows)) assert.deepEqual(rank(permutation), expected);
    assert.deepEqual(rows, before);
  }
});

test("页面显示窗口/剩余天数/覆盖范围/来源/有效期/读取时点及刷新限制", () => {
  const html = renderToStaticMarkup(createElement(MatchResults, { data: {
    demand, demandSource: "mock", providerSource: "mock", performanceSource: "live", readAt: now,
    response: { ok: true, data: matchProviders(demand, [provider("a", availability()), provider("b", null), provider("c", availability(undefined, { validUntil: new Date(now).toISOString() })), provider("d", availability([]))], now), meta: { source: "mock" } },
  } }));
  for (const phrase of ["mock · 固定模拟窗口", "上海自然日", "2028-02-28T16:00:00.000Z", "2028-03-31T16:00:00Z", "2028-02-29", "档期未知", "档期待更新", "没有剩余可用窗口", "可容纳 3 天", "停留期间不会自动更新", "不是预约"]) assert.ok(html.includes(phrase), phrase);
});

test("浏览器用同一读取时点计算排序与展示；刷新跨有效截止会移除档期细排", async t => {
  let clock = now;
  t.mock.method(Date, "now", () => clock);
  const rows = [provider("a", availability([])), provider("b", availability(undefined, { validUntil: new Date(now + 1).toISOString() }))];
  t.mock.method(globalThis, "fetch", async (path: string) => Response.json({ ok: true, data: path === "/api/provider" ? rows : demand, meta: { source: "mock" } }));
  const initial = await loadMatches(demand.id);
  assert.equal(initial.readAt, now);
  assert.deepEqual(initial.response.data.map(row => row.provider.id), ["b", "a"]);
  clock++;
  const refreshed = await loadMatches(demand.id);
  assert.equal(refreshed.readAt, now + 1);
  assert.deepEqual(refreshed.response.data.map(row => row.provider.id), ["a", "b"]);
});
