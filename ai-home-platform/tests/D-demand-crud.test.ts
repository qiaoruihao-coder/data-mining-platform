import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/demand/route";
import { DELETE as detailDELETE, GET as detailGET, PUT as detailPUT } from "../src/app/api/demand/[id]/route";
import { findDemand, listDemands, type DemandDatabase } from "../src/lib/demand";

const input = {
  description: "测试需求：浴室防滑改造。",
  city: "深圳",
  areaM2: 60,
  budgetMinCents: 3000000,
  budgetMaxCents: 5000000,
  renovationType: "elderly" as const,
  desiredDays: 30,
};

const row = { id: "demand-test", ...input, status: "published", ownerId: "demo-owner", createdAt: new Date() };

function fakeDb(rows: typeof row[] = [row]): DemandDatabase {
  return {
    demandOrder: {
      findMany: async () => rows as never,
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = rows.find((value) => value.id === where.id);
        if (!found) return null as never;
        return found as never;
      },
    },
  } as unknown as DemandDatabase;
}

test("POST /api/demand 无同源 Origin 时先拒绝，不消费正文", async () => {
  const request = new Request("http://localhost/api/demand", {
    method: "POST",
    body: JSON.stringify({ ...input, budgetMinCents: 6000000 }),
  });
  const response = await POST(request);
  assert.equal(response.status, 403);
  assert.equal(request.bodyUsed, false);
});

test("需求服务从数据库读取，并避免混合列表把演示需求标成 live", async () => {
  const result = await listDemands(fakeDb());
  assert.equal(result.source, "live");
  assert.equal(result.data[0].id, row.id);
  const demo = await listDemands(fakeDb([{ ...row, id: "demo-demand" }]));
  assert.equal(demo.source, "mock");
  const mixed = await listDemands(fakeDb([{ ...row, id: "demo-demand" }, row]));
  assert.equal(mixed.source, "mock");
});

test("GET /api/demand/[id] 拒绝空 ID，服务详情对未知 ID 返回空", async () => {
  const invalid = await detailGET(new Request("http://localhost/api/demand/%20"), { params: { id: " " } });
  assert.equal(invalid.status, 400);
  const missing = await findDemand("missing", fakeDb([]));
  assert.equal(missing, null);
});

test("PUT/DELETE 路由拒绝空 ID，缺少同源 Origin 时拒绝写入", async () => {
  const invalidId = await detailPUT(new Request("http://localhost/api/demand/%20", { method: "PUT" }), { params: { id: " " } });
  assert.equal(invalidId.status, 400);

  const noOrigin = new Request("http://localhost/api/demand/demand-test", { method: "PUT", body: "{" });
  const forbidden = await detailPUT(noOrigin, { params: { id: "demand-test" } });
  assert.equal(forbidden.status, 403);
  assert.equal(noOrigin.bodyUsed, false);

  const deleteInvalidId = await detailDELETE(new Request("http://localhost/api/demand/%20", { method: "DELETE" }), { params: { id: " " } });
  assert.equal(deleteInvalidId.status, 400);
  const deleteNoOrigin = await detailDELETE(new Request("http://localhost/api/demand/demand-test", { method: "DELETE" }), { params: { id: "demand-test" } });
  assert.equal(deleteNoOrigin.status, 403);
});
