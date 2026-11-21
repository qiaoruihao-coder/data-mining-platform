import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FulfillmentRuler, completedStageCount, newlyStampedFrom } from "../src/components/ui/FulfillmentRuler";

const render = (props: Parameters<typeof FulfillmentRuler>[0]) => renderToStaticMarkup(React.createElement(FulfillmentRuler, props));
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

test("已完成节点数按需求状态计算，已完工时五个节点全部完成", () => {
  assert.deepEqual(
    (["draft", "published", "contracted", "in_progress", "completed"] as const).map(completedStageCount),
    [0, 1, 2, 3, 5],
  );
});

test("只有状态前进才返回新盖章起点；首次读取、不变或后退都不盖章", () => {
  assert.equal(newlyStampedFrom(null, "in_progress"), null);
  assert.equal(newlyStampedFrom(undefined, "completed"), null);
  assert.equal(newlyStampedFrom("contracted", "contracted"), null);
  assert.equal(newlyStampedFrom("in_progress", "contracted"), null);
  assert.equal(newlyStampedFrom("contracted", "in_progress"), 2);
  assert.equal(newlyStampedFrom("in_progress", "completed"), 3);
});

test("盖章动画只作用于新完成的节点，默认不播放", () => {
  assert.equal(count(render({ status: "in_progress" }), /seal-press/g), 0);
  const started = render({ status: "in_progress", animateFrom: 2 });
  assert.equal(count(started, /已确认/g), 3);
  assert.equal(count(started, /seal-press/g), 1);
  const finished = render({ status: "completed", animateFrom: 3 });
  assert.equal(count(finished, /已确认/g), 5);
  assert.equal(count(finished, /seal-press/g), 2);
  assert.match(finished, /五个节点均已完成/);
});
