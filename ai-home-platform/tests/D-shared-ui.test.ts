import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Button, Card, Empty, Field, Note, SectionHead, C } from "../src/components/ui";

test("共享 UI 出口提供基础组件并保留可识别的 focus ring", () => {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(Button, null, "保存"),
      createElement(Card, null, createElement(SectionHead, { title: "标题" }), createElement(Badge, null, "状态")),
      createElement(Field, { label: "名称", children: createElement("input", { className: C.input }) }),
      createElement(Note, { tone: "danger", title: "错误", children: "请重试" }),
      createElement(Empty, { title: "暂无数据" }),
    ),
  );
  assert.match(html, /focus:ring-2 focus:ring-brand\/15/);
  assert.match(html, /role="alert"/);
  assert.match(html, /暂无数据/);
});
