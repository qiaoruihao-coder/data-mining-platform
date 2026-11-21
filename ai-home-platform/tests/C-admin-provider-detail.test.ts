import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider, Ticket, type ProviderDTO, type SourceDTO } from "../src/contracts";
import { ApiClientError } from "../src/lib/api-client";
import Page from "../src/app/admin/provider/[id]/page";
import { AdminProviderDetailContent } from "../src/features/c/AdminProviderDetail";
import { AdminTicketsContent } from "../src/features/c/AdminTickets";
import { adminProviderDetailFailureState, loadAdminProviderDetail, providerKindLabels, type AdminProviderDetailState } from "../src/features/c/admin-provider-detail";

// Synthetic fixtures only. The runtime page does not import or fall back to these profiles.
const provider = Provider.parse({ id: "C-provider", name: "合成服务方", city: "合成城市", kind: "construction", tags: ["合成标签"], rating: 4.2 });
const ticket = Ticket.parse({ id: "C-ticket", demandId: "C-demand", description: "合成工单", category: "quality", status: "assigned", responsibleProviderId: provider.id });
function payload(data: ProviderDTO[] = [provider], source: SourceDTO = "mock") {
  return { ok: true as const, data, meta: { source } };
}
function render(state: AdminProviderDetailState, providerId = provider.id) {
  return renderToStaticMarkup(createElement(AdminProviderDetailContent, { state, providerId, onReload() {} }));
}

test("工单服务方链接精确编码编号，未指定责任方无资料链接且不填默认值", () => {
  const id = "服务方/a b?c#d%";
  const html = renderToStaticMarkup(createElement(AdminTicketsContent, { state: { status: "ready", response: {
    ok: true, data: [{ ...ticket, responsibleProviderId: id }, { ...ticket, id: "unassigned", responsibleProviderId: null }], meta: { source: "live" },
  } }, onReload() {} }));
  assert.ok(html.includes(`href="/admin/provider/${encodeURIComponent(id)}"`));
  assert.match(html, /查看工单 C-ticket 的责任服务方资料/);
  assert.match(html, /暂未指定责任服务方/);
  assert.equal((html.match(/href="\/admin\/provider\//g) ?? []).length, 1);
  assert.doesNotMatch(html, /查看工单 unassigned 的责任服务方资料|provider-a|\/provider\/null/);
  assert.match(html, /href="\/admin\/demand\/C-demand"/);
});

test("只读公共服务方列表并按精确编号选取，不能使用首条记录或附加身份参数", async t => {
  const selected = { ...provider, id: "服务方/a b?c#d%" };
  const first = { ...provider, id: "wrong-provider", name: "错误目标" };
  const fetched = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/provider");
    assert.equal(init, undefined);
    return Response.json(payload([first, selected], "live"));
  });
  const result = await loadAdminProviderDetail(selected.id);
  assert.deepEqual(result, { provider: selected, source: "live" });
  const html = render({ status: "ready", result }, selected.id);
  assert.match(html, /合成服务方/);
  assert.doesNotMatch(html, /错误目标|wrong-provider/);
  assert.equal(fetched.mock.callCount(), 1);
});

test("不存在、大小写或首尾空格不同的编号不会匹配其他资料", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload()));
  for (const id of ["missing", "c-provider", " C-provider", "C-provider "]) {
    const result = await loadAdminProviderDetail(id);
    assert.equal(result.provider, null);
    const html = render({ status: "ready", result }, id);
    assert.match(html, /本次列表未找到该服务方资料/);
    assert.match(html, /不能据此认定服务方不存在或已解除工单责任/);
    assert.match(html, /资料查询来源：模拟标识（mock）/);
    assert.doesNotMatch(html, /<article|合成服务方|provider-a/);
  }
});

test("成功的空列表保留 mock/live 查询来源，不把查询失败混为资料缺失", async t => {
  for (const source of ["mock", "live"] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([], source)));
    const result = await loadAdminProviderDetail(provider.id);
    assert.deepEqual(result, { provider: null, source });
    const html = render({ status: "ready", result });
    assert.match(html, /本次列表未找到该服务方资料/);
    assert.ok(html.includes(source === "mock" ? "资料查询来源：模拟标识（mock）" : "资料查询来源：已保存记录"));
    assert.doesNotMatch(html, /<article|暂时无法加载/);
    fetched.mock.restore();
  }
});

test("资料来源独立披露，类型用中文，不把资料当作责任或能力认证", async t => {
  for (const source of ["mock", "live"] as const) {
    for (const kind of Provider.shape.kind.options) {
      const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(payload([{ ...provider, kind }], source)));
      const html = render({ status: "ready", result: await loadAdminProviderDetail(provider.id) });
      for (const text of ["合成服务方", "合成城市", providerKindLabels[kind], "合成标签", "服务方编号：C-provider",
        "不代表已核实责任、资质或履约能力", "资料与工单分别查询", "查看资料不会派单", "返回售后工单"]) assert.ok(html.includes(text), text);
      assert.match(html, /href="\/admin\/tickets"/);
      assert.ok(html.includes(source === "mock" ? "基础资料与档期分别标明来源" : "来源标识不代表已认证或已核实资料"));
      assert.match(html, /基础资料来源未知/);
      assert.match(html, /档期未知/);
      assert.doesNotMatch(html, /<form|<input|<select|派单成功|已认证服务方|客户满意度|4\.2/);
      assert.equal((html.match(/<button\b/g) ?? []).length, 1); // Refresh only.
      fetched.mock.restore();
    }
  }
});

test("空名称、城市和标签有占位，资料文本被转义，重复标签可显示", () => {
  const empty = render({ status: "ready", result: { provider: { ...provider, name: " \n ", city: " ", tags: [" ", "\n"] }, source: "mock" } });
  for (const text of ["名称未填写", "城市未填写", "暂未提供标签"]) assert.ok(empty.includes(text), text);
  const html = render({ status: "ready", result: { provider: { ...provider, name: '<script>alert("name")</script>', city: "<b>城市</b>",
    tags: ["<img src=x onerror=alert(1)>", "重复标签", "重复标签"] }, source: "live" } });
  for (const text of ["&lt;script&gt;", "&lt;b&gt;", "&lt;img"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/重复标签/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<script|<img|<b>/);
});

test("空编号在网络前拒绝，资料路由保留请求编号且初始不显示成功", async t => {
  const fetched = t.mock.method(globalThis, "fetch", async () => { throw new Error("should not fetch"); });
  await assert.rejects(loadAdminProviderDetail(""), error => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.code, "INVALID_PROVIDER_ID");
    assert.match(render(adminProviderDetailFailureState(error), ""), /服务方编号无效/);
    return true;
  });
  const html = renderToStaticMarkup(createElement(Page, { params: { id: "exact-provider" } }));
  assert.match(html, /服务方编号：exact-provider/);
  assert.match(html, /正在读取服务方资料/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /<article|资料查询来源：|本次列表未找到/);
  assert.equal(fetched.mock.callCount(), 0);
});

test("资料路由只解码一层，保留中文、斜杠、空格和字面百分号编号", () => {
  for (const id of ["服务方/a b?c#d%", "literal%2Fprovider", "provider%25name"]) {
    const page = Page({ params: { id: encodeURIComponent(id) } });
    assert.equal(page.props.providerId, id);
    const html = renderToStaticMarkup(page);
    assert.ok(html.includes(`服务方编号：${id}`));
    assert.match(html, /正在读取服务方资料/);
  }
});

test("重复编号、坏字段、缺来源、坏 JSON 或 200 失败信封均报错而非选择资料", async t => {
  for (const body of [
    payload([provider, provider]), payload([provider, { ...provider, id: "another" }, { ...provider, id: "another" }]),
    { ok: true, data: [provider] }, { ...payload(), meta: { source: "unknown" } },
    { ...payload(), data: null }, { ...payload(), data: provider },
    payload([{ ...provider, id: "" }]), payload([{ ...provider, rating: 6 }]),
    { ...payload(), data: [{ ...provider, kind: "other" }] }, { ...payload(), data: [{ ...provider, tags: "tag" }] },
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "internal secret" } },
  ]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(loadAdminProviderDetail(provider.id), error => {
      const html = render(adminProviderDetailFailureState(error));
      assert.match(html, /资料格式或编号异常/);
      assert.doesNotMatch(html, /<article|合成服务方|资料查询来源：|本次列表未找到|internal secret/);
      return true;
    });
    fetched.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("not json"));
  await assert.rejects(loadAdminProviderDetail(provider.id), error => {
    assert.match(render(adminProviderDetailFailureState(error)), /资料格式或编号异常/);
    return true;
  });
});

test("401、403、404、501、503 保持失败，不发明管理员登录或清除业主会话", async t => {
  for (const [status, text] of [[401, "身份验证未通过"], [403, "无权查看"], [404, "加载失败"], [501, "尚未实现"], [503, "暂时不可用"]] as const) {
    const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: { code: "FAILED", message: "internal secret" } }, { status }));
    await assert.rejects(loadAdminProviderDetail(provider.id), error => {
      const html = render(adminProviderDetailFailureState(error));
      for (const expected of [text, "重新加载", 'role="alert"']) assert.ok(html.includes(expected), expected);
      assert.doesNotMatch(html, /<article|资料查询来源：|本次列表未找到|internal secret|平台管理身份验证|退出业主会话/);
      return true;
    });
    assert.equal(fetched.mock.callCount(), 1);
    fetched.mock.restore();
  }
});

test("HTTP 501 即使成功信封或非 JSON 仍为未实现，网络失败不回退 mock", async t => {
  for (const response of [Response.json(payload(), { status: 501 }), new Response("not json", { status: 501 })]) {
    const fetched = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(loadAdminProviderDetail(provider.id), error => {
      assert.match(render(adminProviderDetailFailureState(error)), /尚未实现/);
      return true;
    });
    fetched.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network secret"); });
  await assert.rejects(loadAdminProviderDetail(provider.id), error => {
    const html = render(adminProviderDetailFailureState(error));
    assert.match(html, /加载失败/);
    assert.doesNotMatch(html, /<article|资料查询来源：|本次列表未找到|network secret/);
    return true;
  });
});

test("重新查询可恢复失败、更新资料及来源或显示缺失，不保留旧结果", async t => {
  const responses = [Response.json(payload()), Response.json({ ok: false }, { status: 503 }),
    Response.json(payload([{ ...provider, name: "更新名称", city: "更新城市", kind: "design", tags: [] }], "live")), Response.json(payload([], "live"))];
  const fetched = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.match(render({ status: "ready", result: await loadAdminProviderDetail(provider.id) }), /合成服务方/);
  await assert.rejects(loadAdminProviderDetail(provider.id), error => {
    assert.doesNotMatch(render(adminProviderDetailFailureState(error)), /合成服务方|<article/);
    return true;
  });
  assert.doesNotMatch(render({ status: "loading" }), /合成服务方|<article|资料查询来源：|本次列表未找到/);
  const updated = render({ status: "ready", result: await loadAdminProviderDetail(provider.id) });
  for (const text of ["更新名称", "更新城市", "设计服务", "暂未提供标签", "已保存记录"]) assert.ok(updated.includes(text), text);
  assert.doesNotMatch(updated, /合成服务方|合成标签|模拟标识（mock）/);
  assert.match(render({ status: "ready", result: await loadAdminProviderDetail(provider.id) }), /本次列表未找到该服务方资料/);
  assert.equal(fetched.mock.callCount(), 4);
});
