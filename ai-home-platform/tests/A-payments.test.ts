import test from "node:test";
import assert from "node:assert/strict";
import { Payment } from "../src/contracts";
import {
  confirmDemoPayment,
  detectPaymentIssues,
  paymentStatusLabel,
  paymentStatusTone,
  paymentSummary,
  sharePercent,
  toPaymentNodes,
  type PaymentDTO,
} from "../src/features/a/payments";

function node(over: Partial<PaymentDTO> & Pick<PaymentDTO, "id" | "stage">): PaymentDTO {
  return {
    demandId: "demo-demand",
    amountCents: 100000,
    status: "pending",
    simulated: true,
    ...over,
  };
}

test("汇总金额只统计有效节点，已确认与待确认能对上总数", () => {
  const list = [
    node({ id: "p1", stage: "签约节点", amountCents: 390000, status: "confirmed_demo" }),
    node({ id: "p2", stage: "水电验收", amountCents: 260000 }),
    node({ id: "p3", stage: "竣工验收", amountCents: 350000 }),
  ];
  const summary = paymentSummary(list);
  assert.equal(summary.count, 3);
  assert.equal(summary.totalCents, 1000000);
  assert.equal(summary.confirmedCents, 390000);
  assert.equal(summary.pendingCents, 610000);
  assert.equal(summary.confirmedCount, 1);
  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.confirmedPercent, 39);
});

test("空列表不会算出 NaN 或 100%", () => {
  const summary = paymentSummary([]);
  assert.equal(summary.totalCents, 0);
  assert.equal(summary.confirmedPercent, 0);
  assert.equal(sharePercent(1000, 0), 0);
});

test("节点占比保留一位小数，负数按 0 处理", () => {
  assert.equal(sharePercent(330000, 1000000), 33);
  assert.equal(sharePercent(1, 3), 33.3);
  assert.equal(sharePercent(-5, 100), 0);
});

test("状态有中文文案与色调，不把英文枚举抛给业主", () => {
  assert.equal(paymentStatusLabel("pending"), "待确认");
  assert.equal(paymentStatusLabel("confirmed_demo"), "已确认（演示）");
  assert.equal(paymentStatusTone("pending"), "accent");
  assert.ok(!paymentStatusLabel("confirmed_demo").includes("confirmed_demo"));
});

test("演示确认使用公共动作契约并保留接口来源", async (t) => {
  let requestInput: RequestInfo | URL | undefined;
  let requestInit: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requestInput = input;
    requestInit = init;
    return Response.json({
      ok: true,
      data: Payment.parse({
        id: "p1", demandId: "demo-demand", stage: "签约节点",
        amountCents: 100000, status: "confirmed_demo", simulated: true,
      }),
      meta: { source: "mock" },
    });
  });

  const result = await confirmDemoPayment("p1");
  assert.equal(result.data.status, "confirmed_demo");
  assert.equal(result.source, "mock");
  assert.equal(requestInput, "/api/payment");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { paymentId: "p1", action: "confirm_demo" });
});

test("付款计划自检能抓出重名节点、零金额、混入其他需求", () => {
  assert.deepEqual(detectPaymentIssues([node({ id: "p1", stage: "签约节点" })]), []);

  const duplicated = detectPaymentIssues([
    node({ id: "p1", stage: "签约节点" }),
    node({ id: "p2", stage: "签约节点" }),
  ]);
  assert.ok(duplicated.some((issue) => issue.code === "duplicate-stage"));

  const zero = detectPaymentIssues([node({ id: "p1", stage: "尾款", amountCents: 0 })]);
  assert.ok(zero.some((issue) => issue.code === "zero-amount"));

  const mixed = detectPaymentIssues([
    node({ id: "p1", stage: "签约节点" }),
    node({ id: "p2", stage: "水电验收", demandId: "other-demand" }),
  ]);
  assert.ok(mixed.some((issue) => issue.code === "mixed-demand"));
});

test("空付款计划单独报「没有节点」，避免页面出现一块空白", () => {
  const issues = detectPaymentIssues([]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "no-items");
});

test("时间线节点按接口顺序编号，并带上占比与模拟标记", () => {
  const nodes = toPaymentNodes([
    node({ id: "p1", stage: "签约节点", amountCents: 250000 }),
    node({ id: "p2", stage: "竣工", amountCents: 750000 }),
  ]);
  assert.deepEqual(
    nodes.map((item) => item.index),
    [1, 2],
  );
  assert.equal(nodes[0].stage, "签约节点");
  assert.equal(nodes[0].sharePercent, 25);
  assert.equal(nodes[1].sharePercent, 75);
  assert.equal(nodes[0].simulated, true);
  assert.equal(nodes[1].statusLabel, "待确认");
});
