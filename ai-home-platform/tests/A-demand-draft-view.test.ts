import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatResult } from "../src/contracts";
import { DemandDraftPanel } from "../src/features/a/DemandDraftPanel";

// 为 jsx:preserve 下的渲染测试提供 React，结束后恢复。
const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});
const render = (result: React.ComponentProps<typeof DemandDraftPanel>["result"], source: "mock" | "live" | null = null) => renderToStaticMarkup(
  createElement(DemandDraftPanel, { result, source, onSubmittingChange() {} }),
);

test("首次未请求或首次对话失败时，无结果也提供手动入口，不声称已有草稿或已保存", () => {
  const html = render(null);
  assert.match(html, /<button[^>]*>手动填写需求单<\/button>/);
  assert.match(html, /即使对话暂时不可用/);
  assert.match(html, /这部分内容由您填写，不是助手整理的结果/);
  assert.doesNotMatch(html, /POST \/api|D 的|AI 生成|\bmock\b|AI_MODE/);
  assert.doesNotMatch(html, /草稿来源：|需求已创建|打开需求详情/);
});

test("模拟追问不将固定示例当作用户缺失信息，并提供手动填写入口", () => {
  const result = ChatResult.parse({ reply: "测试追问", ready: false, draft: null, missingFields: ["city"] });
  const html = render(result, "mock");
  assert.match(html, /手动填写需求单/);
  assert.match(html, /模拟追问示例/);
  assert.match(html, /不代表您没有提供这些信息/);
  assert.match(html, /不会自动整理需求/);
  assert.match(html, /城市/);
  assert.doesNotMatch(html, /还缺这|需求已创建/);
});

test("真实追问保留接口返回的缺失信息，不误标模拟模式", () => {
  const result = ChatResult.parse({ reply: "请补充城市", ready: false, draft: null, missingFields: ["city"] });
  const html = render(result, "live");
  assert.match(html, /还缺这 1 项信息/);
  assert.match(html, /城市/);
  assert.match(html, /手动填写需求单/);
  assert.doesNotMatch(html, /模拟追问示例|不会自动整理需求|需求已创建/);
});

test("有契约草稿时直接展示可核对字段和来源，不重复提供手动入口", () => {
  const result = ChatResult.parse({
    reply: "测试草稿", ready: true, missingFields: [],
    draft: { description: "测试手动核对", city: "深圳", areaM2: 60, budgetMinCents: 100000, budgetMaxCents: 200000, renovationType: "repair", desiredDays: 10 },
  });
  const html = render(result, "mock");
  assert.match(html, /草稿来源：模拟结果/);
  assert.match(html, /测试手动核对/);
  assert.match(html, /确认并提交需求/);
  assert.doesNotMatch(html, /POST \/api|D 的|AI 生成|\bmock\b|AI_MODE/);
  assert.doesNotMatch(html, /手动填写需求单|需求已创建/);
});

test("保存返回 401/403 时显示对应指引且不丢失已填写内容", () => {
  const draft = ChatResult.parse({
    reply: "测试草稿", ready: true, missingFields: [],
    draft: { description: "已填写的需求", city: "深圳", areaM2: 60, budgetMinCents: 100000, budgetMaxCents: 200000, renovationType: "repair", desiredDays: 10 },
  });
  const authHtml = render(draft, "mock");
  assert.match(authHtml, /确认并提交需求/);
  assert.match(authHtml, /结构化需求单/);
  assert.match(authHtml, /已填写的需求/);
});
