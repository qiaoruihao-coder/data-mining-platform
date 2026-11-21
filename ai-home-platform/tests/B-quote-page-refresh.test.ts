import test from "node:test";
import assert from "node:assert/strict";
import { subscribeQuotePageRefresh } from "../src/features/b/quote-page-refresh";
import { loadQuoteComparison } from "../src/features/b/load-quotes";
import { ApiClientError } from "../src/lib/api-client";
import { demoDemand, providers, quotes } from "../src/lib/mock-data";

class TestPage extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  focused = true;
  hasFocus() { return this.focused; }
  visibility(value: DocumentVisibilityState) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type));
const pageShow = (target: EventTarget, persisted: boolean) => {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  target.dispatchEvent(event);
};

test("初次订阅不重复读取，离开窗口再聚焦刷新，每次返回仅一次", () => {
  const viewport = new EventTarget();
  const page = new TestPage();
  let count = 0;
  const cleanup = subscribeQuotePageRefresh(() => count++, viewport, page);
  assert.equal(count, 0);
  pageShow(viewport, false);
  fire(viewport, "focus");
  assert.equal(count, 0);
  fire(viewport, "blur");
  fire(viewport, "focus");
  fire(viewport, "focus");
  page.visibility("visible");
  assert.equal(count, 1);
  fire(viewport, "blur");
  fire(viewport, "focus");
  assert.equal(count, 2);
  cleanup();
});

test("标签页隐藏时不请求，focus 与可见事件的两种顺序都只刷新一次", () => {
  for (const focusFirst of [true, false]) {
    const viewport = new EventTarget();
    const page = new TestPage();
    let count = 0;
    const cleanup = subscribeQuotePageRefresh(() => count++, viewport, page);
    fire(viewport, "blur");
    page.visibility("hidden");
    fire(viewport, "focus");
    pageShow(viewport, true);
    assert.equal(count, 0);
    page.visibilityState = "visible";
    if (focusFirst) fire(viewport, "focus");
    fire(page, "visibilitychange");
    if (!focusFirst) fire(viewport, "focus");
    assert.equal(count, 1);
    cleanup();
  }
});

test("在后台挂载后首次返回会刷新，浏览器缓存恢复也重新读取", () => {
  const viewport = new EventTarget();
  const page = new TestPage();
  page.visibilityState = "hidden";
  page.focused = false;
  let count = 0;
  const cleanup = subscribeQuotePageRefresh(() => count++, viewport, page);
  page.visibility("visible");
  fire(viewport, "focus");
  assert.equal(count, 1);
  fire(viewport, "pagehide");
  pageShow(viewport, true);
  fire(viewport, "focus");
  assert.equal(count, 2);
  cleanup();
});

test("清理所有监听；重新订阅不会留下旧回调，兼容 effect 重挂载", () => {
  const viewport = new EventTarget();
  const page = new TestPage();
  let oldCalls = 0;
  let newCalls = 0;
  const cleanup = subscribeQuotePageRefresh(() => oldCalls++, viewport, page);
  cleanup();
  cleanup();
  const nextCleanup = subscribeQuotePageRefresh(() => newCalls++, viewport, page);
  fire(viewport, "blur");
  page.visibility("hidden");
  page.visibility("visible");
  fire(viewport, "focus");
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
  nextCleanup();
  fire(viewport, "pagehide");
  pageShow(viewport, true);
  fire(viewport, "blur");
  fire(viewport, "focus");
  page.visibility("hidden");
  page.visibility("visible");
  assert.equal(newCalls, 1);
});

test("返回触发按需求重新查询，能读取新增报价；权限失效仍失败且不回退演示接口", async t => {
  const viewport = new EventTarget();
  const page = new TestPage();
  let rows = quotes;
  let denied = false;
  const urls: string[] = [];
  // 合成响应用于验证事件与读取器接线，不代表真实业务报价。
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    if (denied) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "会话失效" } }, { status: 401 });
    return Response.json({ ok: true, data: url.startsWith("/api/quote?") ? rows : url === "/api/provider" ? providers : demoDemand, meta: { source: "mock" } });
  });
  let reading = loadQuoteComparison(demoDemand.id);
  assert.equal((await reading).response.data.length, 2);
  const cleanup = subscribeQuotePageRefresh(() => { reading = loadQuoteComparison(demoDemand.id); }, viewport, page);
  t.after(cleanup);
  fire(viewport, "blur");
  rows = [...quotes, { ...quotes[0], id: "synthetic-new-quote" }];
  fire(viewport, "focus");
  page.visibility("visible");
  assert.equal((await reading).response.data.length, 3);
  assert.equal(urls.filter(url => url.startsWith("/api/quote?")).length, 2);
  denied = true;
  fire(viewport, "blur");
  const before = urls.length;
  fire(viewport, "focus");
  await assert.rejects(reading, error => error instanceof ApiClientError && error.status === 401);
  assert.deepEqual(urls.slice(before), [`/api/quote?demandId=${demoDemand.id}`]);
  assert.ok(!urls.includes("/api/quote"));
});
