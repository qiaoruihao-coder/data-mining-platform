import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider, type ProviderDTO, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import Page from "../src/app/admin/provider-reviews/page";
import AdminPage from "../src/app/admin/page";
import { AdminProviderReviewsContent } from "../src/features/c/AdminProviderReviews";
import { adminProviderReviewsFailure, defaultAdminProviderReviewFilters, loadAdminProviderReviews, type AdminProviderReviewsState } from "../src/features/c/admin-provider-reviews";

// Synthetic test fixtures; the runtime UI never substitutes these for a failed API response.
const performance = { basis: "completed_order_review_average" as const, averageRating: 4.25, reviewCount: 4,
  calculatedAt: "2026-11-14T10:00:00.000Z", source: "live" as const };
const provider = Provider.parse({ id: "C-review-provider", name: "合成评价服务方", city: "合成城市", kind: "construction",
  tags: [], rating: 4.99, source: "mock", performance });
function payload(data: ProviderDTO[] = [provider], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: AdminProviderReviewsState, source: SourceDTO = "live") {
  return renderToStaticMarkup(createElement(AdminProviderReviewsContent, { source, state, onSourceChange() {}, onReload() {},
    filters: defaultAdminProviderReviewFilters, onFiltersChange() {} }));
}

test("评价看板入口可达，首次加载默认 live，不提前显示统计或成功来源", () => {
  const entry = renderToStaticMarkup(createElement(AdminPage));
  assert.match(entry, /href="\/admin\/provider-reviews"/);
  assert.match(entry, /查看服务方评价汇总/);
  const html = renderToStaticMarkup(createElement(Page));
  for (const text of ["服务方评价汇总", "正在读取实际记录（live）的评价汇总", 'disabled=""', 'href="/admin"', 'value="live" selected=""']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<dd|目录响应来源：|本次目录暂无服务方|暂无均分/);
});

test("仅按公共 performanceSource 查询，mock 和 live 独立请求并保留目录顺序", async t => {
  for (const source of ["live", "mock"] as const) {
    const data = [{ ...provider, id: "z-first", performance: { ...performance, source } },
      { ...provider, id: "a-second", performance: { ...performance, source, averageRating: 5 } }];
    const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
      assert.equal(path, `/api/provider?performanceSource=${source}`);
      assert.equal(init, undefined);
      return Response.json(payload(data));
    });
    assert.deepEqual(await loadAdminProviderReviews(source), payload(data));
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("非法来源在请求前拒绝，不回退默认口径", async t => {
  const fetched = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected fetch"); });
  await assert.rejects(loadAdminProviderReviews("other" as SourceDTO), error => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.code, "INVALID_QUERY");
    return true;
  });
  assert.equal(fetched.mock.callCount(), 0);
});

test("目录整体、基础资料和评价各自标明来源，显示均分样本时间而不使用旧 rating", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload()));
  const html = render({ status: "ready", response: await loadAdminProviderReviews("live") });
  for (const text of ["目录响应来源：模拟记录（mock）", "基础资料来源：模拟记录（mock）", "评价来源：实际记录（live）",
    "合成评价服务方", "合成城市", "C-review-provider", "4.25", "4 条", performance.calculatedAt,
    "已完成接单的业主评价", "不代表准时率、质量认证或信用分", "角色导航不代表管理员登录"]) assert.ok(html.includes(text), text);
  assert.match(html, /<time dateTime="2026-11-14T10:00:00.000Z"/);
  assert.doesNotMatch(html, /4\.99|样本少|<form|平台总均分|排名/);
  const liveProfile = render({ status: "ready", response: payload([{ ...provider, source: "live" }]) });
  assert.match(liveProfile, /基础资料来源：实际记录（live）/);
});

test("0 样本为 null 无均分，1/2 条提示样本少，3 条起不显示少样本提示", async t => {
  for (const count of [0, 1, 2, 3]) {
    const data = [{ ...provider, performance: { ...performance, source: "mock" as const, reviewCount: count, averageRating: count === 0 ? null : 5 } }];
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload(data)));
    const html = render({ status: "ready", response: await loadAdminProviderReviews("mock") }, "mock");
    assert.match(html, /评价来源：模拟记录（mock）/);
    assert.ok(html.includes(`${count} 条`));
    assert.equal(html.includes("样本少（少于 3 条）"), count < 3);
    assert.equal(html.includes("暂无该来源样本"), count === 0);
    assert.equal(html.includes("暂无均分"), count === 0);
    assert.equal(html.includes("5.00"), count > 0);
    assert.doesNotMatch(html, />0\.00<|>4\.99</);
    fetched.mock.restore();
  }
});

test("旧 DTO 缺少或 null 汇总不等于无样本，缺少基础资料来源不继承目录来源", async t => {
  for (const value of [undefined, null]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([{ ...provider, source: undefined, performance: value }], "live")));
    const html = render({ status: "ready", response: await loadAdminProviderReviews("live") });
    assert.match(html, /未提供评价汇总，暂不能判断是否有样本/);
    assert.match(html, /基础资料来源：未知（未提供）/);
    assert.match(html, /目录响应来源：实际记录（live）/);
    assert.doesNotMatch(html, /评价来源：|暂无该来源样本|暂无均分|>0 条<|4\.99|<time/);
    fetched.mock.restore();
  }
});

test("成功空目录保留查询来源，不将请求失败解释为空目录", async t => {
  for (const source of ["live", "mock"] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([], source)));
    const html = render({ status: "ready", response: await loadAdminProviderReviews(source) }, source);
    assert.match(html, /本次目录暂无服务方/);
    assert.match(html, /不能据此判断平台没有服务方或评价/);
    assert.match(html, /目录响应来源：/);
    assert.doesNotMatch(html, /<dd|评价来源：|合成评价服务方/);
    fetched.mock.restore();
  }
});

test("空白资料有占位，文本转义，未来计算时间按公共契约保留", async t => {
  const calculatedAt = "2099-12-31T23:59:59+08:00";
  t.mock.method(globalThis, "fetch", async () => Response.json(payload([{ ...provider, id: 'id/<script>', name: '<img src=x onerror=alert(1)>',
    city: " \n ", performance: { ...performance, calculatedAt } }])));
  const html = render({ status: "ready", response: await loadAdminProviderReviews("live") });
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/); assert.match(html, /城市未填写/);
  assert.ok(html.includes(calculatedAt)); assert.doesNotMatch(html, /<img|<script/);
  assert.match(render({ status: "ready", response: payload([{ ...provider, name: " " }]) }), /名称未填写/);
});

test("拒绝来源串用、重复编号及不合法汇总，不过滤坏记录后伪装成功", async t => {
  const badData = [
    [provider, provider], [{ ...provider, performance: { ...performance, source: "mock" } }],
    [{ ...provider, performance: { ...performance, source: "unknown" } }],
    [{ ...provider, performance: { ...performance, reviewCount: 0 } }],
    [{ ...provider, performance: { ...performance, averageRating: null } }],
    [{ ...provider, performance: { ...performance, averageRating: 0 } }],
    [{ ...provider, performance: { ...performance, averageRating: 5.01 } }],
    [{ ...provider, performance: { ...performance, reviewCount: -1 } }],
    [{ ...provider, performance: { ...performance, reviewCount: 1.5 } }],
    [{ ...provider, performance: { ...performance, calculatedAt: "invalid" } }],
    [{ ...provider, performance: { ...performance, basis: "credit_score" } }],
    [{ ...provider, performance: { ...performance, comments: ["private-comment"] } }],
  ];
  for (const data of badData) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, data, meta: { source: "mock" } }));
    await assert.rejects(loadAdminProviderReviews("live"), error => {
      const html = render(adminProviderReviewsFailure(error));
      assert.match(html, /格式、编号或来源异常/);
      assert.doesNotMatch(html, /<dd|合成评价服务方|暂无该来源样本|private-comment|目录响应来源：/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("缺信封来源、坏 JSON 和 200 失败信封不会显示成功", async t => {
  for (const response of [Response.json({ ok: true, data: [provider] }), Response.json({ ok: false, error: { code: "FAILED", message: "private error" } }), new Response("not json")]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(loadAdminProviderReviews("live"), error => {
      const html = render(adminProviderReviewsFailure(error));
      assert.match(html, /格式、编号或来源异常/);
      assert.doesNotMatch(html, /<dd|目录响应来源：|private error|本次目录暂无/);
      return true;
    });
    fetched.mock.restore();
  }
});

test("401/403/404/501/503、伪成功和网络失败保持错误，不能自动回退 mock", async t => {
  for (const [status, message] of [[401, "未获授权"], [403, "未获授权"], [404, "加载失败"], [501, "尚未实现"], [503, "暂时不可用"]] as const) {
    for (const response of [Response.json(payload(), { status }), new Response("private error", { status })]) {
      const fetched = t.mock.method(globalThis, "fetch", async () => response);
      await assert.rejects(loadAdminProviderReviews("live"), error => {
        const html = render(adminProviderReviewsFailure(error));
        for (const text of [message, "重新加载", 'role="alert"']) assert.ok(html.includes(text), text);
        assert.doesNotMatch(html, /<dd|目录响应来源：|暂无该来源样本|private error|本次目录暂无/);
        return true;
      });
      assert.equal(fetched.mock.callCount(), 1);
      fetched.mock.restore();
    }
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private network error"); });
  await assert.rejects(loadAdminProviderReviews("mock"), error => {
    assert.match(render(adminProviderReviewsFailure(error)), /加载失败/); return true;
  });
});

test("重新查询可更新均分或恢复失败；加载和错误状态不残留旧统计", async t => {
  const responses = [Response.json(payload()), Response.json({ ok: false }, { status: 503 }),
    Response.json(payload([{ ...provider, performance: { ...performance, averageRating: 3.5, reviewCount: 2, source: "mock" } }])), Response.json(payload([]))];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.match(render({ status: "ready", response: await loadAdminProviderReviews("live") }), /4\.25/);
  await assert.rejects(loadAdminProviderReviews("live"), error => {
    assert.doesNotMatch(render(adminProviderReviewsFailure(error)), /4\.25|合成评价服务方|<dd/); return true;
  });
  assert.doesNotMatch(render({ status: "loading" }, "mock"), /4\.25|合成评价服务方|<dd/);
  const html = render({ status: "ready", response: await loadAdminProviderReviews("mock") }, "mock");
  assert.match(html, /3\.50/); assert.match(html, /评价来源：模拟记录（mock）/); assert.match(html, /样本少/);
  assert.doesNotMatch(html, /4\.25|评价来源：实际记录/);
  assert.match(render({ status: "ready", response: await loadAdminProviderReviews("live") }), /本次目录暂无服务方/);
});
