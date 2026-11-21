import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider, ProviderAvailability as AvailabilitySchema, type ProviderDTO } from "../src/contracts";
import { AdminProviderDetailContent } from "../src/features/c/AdminProviderDetail";
import { ProviderAvailability, ProviderAvailabilityContent } from "../src/features/c/ProviderAvailability";
import { providerAvailabilityStatus } from "../src/features/c/provider-availability";
import { adminProviderDetailFailureState, loadAdminProviderDetail, type AdminProviderDetailState } from "../src/features/c/admin-provider-detail";

// Synthetic test data; never imported by the runtime page or used as an API fallback.
const availability = AvailabilitySchema.parse({
  windows: [{ startDate: "2026-11-20", endDate: "2026-11-30" }, { startDate: "2026-12-05", endDate: "2026-12-05" }],
  coverageStartDate: "2026-11-15", coverageEndDate: "2026-12-31",
  updatedAt: "2026-11-14T00:00:00.000Z", validUntil: "2026-12-31T23:59:59.000Z", source: "mock",
});
const provider = Provider.parse({ id: "C-availability", name: "合成档期服务方", city: "合成城市", kind: "construction", tags: [], rating: 0, source: "mock", availability });
const now = Date.parse("2026-11-14T01:00:00Z");
const deadline = Date.parse(availability.validUntil);
function render(value: ProviderDTO["availability"] = availability, at: number | null = now) {
  return renderToStaticMarkup(createElement(ProviderAvailabilityContent, { availability: value, now: at }));
}
function renderPage(state: AdminProviderDetailState) {
  return renderToStaticMarkup(createElement(AdminProviderDetailContent, { providerId: provider.id, state, onReload() {} }));
}
function payload(data: unknown = [provider], source = "mock") {
  return { ok: true, data, meta: { source } };
}

test("缺省/null 档期为未知，不推断来源、覆盖范围或没有窗口", () => {
  for (const value of [undefined, null]) {
    assert.equal(providerAvailabilityStatus(value, now), "unknown");
    const html = renderToStaticMarkup(createElement(ProviderAvailabilityContent, { availability: value, now }));
    assert.match(html, /档期未知/);
    assert.doesNotMatch(html, /档期来源：|<time|没有已确认窗口|档期待更新/);
  }
});

test("空窗口仅描述本次覆盖区间，来源与更新时间仍可核对", () => {
  const empty = AvailabilitySchema.parse({ ...availability, windows: [] });
  assert.equal(providerAvailabilityStatus(empty, now), "empty");
  const html = render(empty);
  for (const text of ["本次覆盖区间内没有已确认窗口", "不代表其他日期没有档期", availability.coverageStartDate,
    availability.coverageEndDate, availability.updatedAt, availability.validUntil, "档期来源：模拟标识（mock）"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /档期未知|aria-label="已记录档期窗口"|档期待更新/);
});

test("多段和单日窗口原样展示，不转时区、不算预约或施工承诺", () => {
  const html = render();
  assert.equal(providerAvailabilityStatus(availability, now), "recorded");
  for (const window of availability.windows) {
    assert.match(html, new RegExp(`datetime="${window.startDate}"`, "i"));
    assert.match(html, new RegExp(`datetime="${window.endDate}"`, "i"));
  }
  for (const text of ["Asia/Shanghai 自然日，含首尾日", "档期为模拟样例", "不代表预约、锁定或施工承诺", "按当前设备时间核对"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<li\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<button|<form|<input|<select|预约成功|可立即开工/);
});

test("截止前可查看，达到或超过截止即待更新，过期空数组不继续宣称无窗口", () => {
  assert.equal(providerAvailabilityStatus(availability, deadline - 1), "recorded");
  for (const at of [deadline, deadline + 1, deadline + 86400000]) {
    for (const windows of [availability.windows, []]) {
      const value = AvailabilitySchema.parse({ ...availability, windows });
      assert.equal(providerAvailabilityStatus(value, at), "expired");
      const html = render(value, at);
      assert.match(html, /档期待更新/);
      assert.match(html, /档期来源：模拟标识（mock）/);
      assert.ok(html.includes(availability.validUntil));
      assert.doesNotMatch(html, /2026-11-20|2026-12-05|aria-label="已记录档期窗口"|没有已确认窗口|档期未知/);
    }
  }
});

test("有效截止按时间戳比较含时区偏移，不按字符串比较", () => {
  const value = AvailabilitySchema.parse({ ...availability, validUntil: "2027-01-01T07:59:59+08:00" });
  assert.equal(providerAvailabilityStatus(value, deadline - 1), "recorded");
  assert.equal(providerAvailabilityStatus(value, deadline), "expired");
  assert.ok(render(value, deadline).includes("2027-01-01T07:59:59+08:00"));
});

test("设备时间未准备好时不展示窗口；合法未来更新时间不被当作坏 DTO", () => {
  for (const at of [null, NaN, Infinity]) {
    assert.equal(providerAvailabilityStatus(availability, at), "checking");
    assert.match(render(availability, at), /正在核对档期有效期/);
    assert.doesNotMatch(render(availability, at), /aria-label="已记录档期窗口"|档期待更新/);
  }
  const html = renderToStaticMarkup(createElement(ProviderAvailability, { availability }));
  assert.match(html, /正在核对档期有效期/);
  assert.doesNotMatch(html, /aria-label="已记录档期窗口"/);
  const future = AvailabilitySchema.parse({ ...availability, updatedAt: "2026-12-01T00:00:00Z" });
  assert.equal(providerAvailabilityStatus(future, now), "recorded");
});

test("目录、基础资料、档期来源独立；旧基础资料不继承目录来源", async t => {
  for (const [directorySource, profileSource, availabilitySource] of [
    ["mock", "mock", "live"], ["live", "live", "mock"], ["live", undefined, "mock"],
  ] as const) {
    const selected = Provider.parse({ ...provider, source: profileSource, availability: { ...availability, source: availabilitySource } });
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([selected], directorySource)));
    const result = await loadAdminProviderDetail(provider.id);
    const html = renderPage({ status: "ready", result });
    assert.ok(html.includes(`资料查询来源：${directorySource === "mock" ? "模拟标识（mock）" : "已保存记录"}`));
    assert.ok(html.includes(profileSource === undefined ? "基础资料来源未知" : `基础资料来源：${profileSource === "mock" ? "模拟标识（mock）" : "已保存记录"}`));
    assert.ok(html.includes(`档期来源：${availabilitySource === "mock" ? "模拟标识（mock）" : "已保存记录"}`));
    assert.match(render(selected.availability), availabilitySource === "mock" ? /档期为模拟样例/ : /来源标识不代表服务方已确认接单/);
    fetched.mock.restore();
  }
});

test("坏档期由公共契约拒绝整次查询，不伪装未知或空窗口", async t => {
  for (const invalid of [
    { ...availability, source: "unknown" }, { ...availability, validUntil: "not-a-date" },
    { ...availability, windows: [{ startDate: "2026-02-30", endDate: "2026-12-01" }] },
    { ...availability, windows: [{ startDate: "2026-11-14", endDate: "2026-11-20" }] },
    { ...availability, windows: [...availability.windows, availability.windows[0]] },
    { ...availability, updatedAt: "2027-01-01T00:00:00Z" },
  ]) {
    // Even a bad unselected profile must be rejected, as the API validates the whole directory.
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([provider, { ...provider, id: "other", availability: invalid }])));
    await assert.rejects(loadAdminProviderDetail(provider.id), error => {
      const html = renderPage(adminProviderDetailFailureState(error));
      assert.match(html, /资料格式或编号异常/);
      assert.doesNotMatch(html, /服务方档期|档期未知|没有已确认窗口|档期来源：/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("501 成功信封、503 及网络失败均不展示档期，加载/缺失也无旧窗口", async t => {
  for (const status of [501, 503]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload(), { status }));
    await assert.rejects(loadAdminProviderDetail(provider.id), error => {
      const html = renderPage(adminProviderDetailFailureState(error));
      assert.match(html, status === 501 ? /尚未实现/ : /暂时不可用/);
      assert.doesNotMatch(html, /服务方档期|档期来源：|档期未知/);
      return true;
    });
    fetched.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(loadAdminProviderDetail(provider.id), error => {
    assert.doesNotMatch(renderPage(adminProviderDetailFailureState(error)), /服务方档期|档期未知/);
    return true;
  });
  for (const state of [{ status: "loading" }, { status: "ready", result: { provider: null, source: "mock" } }] as const) {
    assert.doesNotMatch(renderPage(state), /服务方档期|2026-11-20|档期来源：/);
  }
});

test("重新查询取得新的档期与独立来源，也可变为未知", async t => {
  const responses = [payload(), payload([{ ...provider, availability: { ...availability, windows: [], source: "live" } }]), payload([{ ...provider, availability: null }])];
  t.mock.method(globalThis, "fetch", async () => Response.json(responses.shift()));
  const first = await loadAdminProviderDetail(provider.id);
  assert.match(render(first.provider?.availability), /aria-label="已记录档期窗口"/);
  const second = await loadAdminProviderDetail(provider.id);
  assert.match(render(second.provider?.availability), /档期来源：已保存记录/);
  assert.match(render(second.provider?.availability), /没有已确认窗口/);
  assert.doesNotMatch(render(second.provider?.availability), /2026-11-20/);
  const third = await loadAdminProviderDetail(provider.id);
  assert.match(render(third.provider?.availability), /档期未知/);
  assert.doesNotMatch(render(third.provider?.availability), /档期来源：|没有已确认窗口/);
});
