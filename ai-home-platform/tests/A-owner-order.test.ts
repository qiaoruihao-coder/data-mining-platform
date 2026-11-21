import test from "node:test";
import assert from "node:assert/strict";
import { OrderSummary } from "../src/contracts";
import { loadOwnerOrder } from "../src/features/a/owner-order";

const order = OrderSummary.parse({ id: "order-1", demandId: "demand-1", providerId: "provider-a", acceptedQuoteId: "quote-1", status: "contracted", source: "live" });
const ok = (data: unknown = order, source = "live") => ({ ok: true, data, meta: { source } });

test("业主接单读取使用精确编码的 demandId，保留 orderId、providerId 和来源", async (t) => {
  const id = "需求/a?&#";
  const request = t.mock.method(globalThis, "fetch", async (path: string) => {
    assert.equal(path, `/api/order?demandId=${encodeURIComponent(id)}`);
    return Response.json(ok({ ...order, demandId: id }));
  });
  const result = await loadOwnerOrder(id);
  assert.equal(result.phase, "ready");
  if (result.phase === "ready") {
    assert.equal(result.order?.id, "order-1");
    assert.equal(result.order?.providerId, "provider-a");
    assert.equal(result.source, "live");
  }
  assert.equal(request.mock.callCount(), 1);
});

test("没有接单时保留明确 null，不回退固定演示订单", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json(ok(null, "live")));
  const result = await loadOwnerOrder("demand-1");
  assert.deepEqual(result, { phase: "ready", order: null, source: "live" });
  assert.equal(request.mock.callCount(), 1);
});

test("错位接单、401、503、501 和网络错误都失败且不生成假订单", async (t) => {
  for (const response of [
    Response.json(ok({ ...order, demandId: "other" })),
    Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "请登录" } }, { status: 401 }),
    Response.json({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "暂不可用" } }, { status: 503 }),
    Response.json(ok(), { status: 501 }),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await loadOwnerOrder("demand-1");
    assert.equal(result.phase, "failed");
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const result = await loadOwnerOrder("demand-1");
  assert.equal(result.phase, "failed");
});
