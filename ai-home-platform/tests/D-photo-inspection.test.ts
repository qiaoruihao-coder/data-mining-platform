import test from "node:test";
import assert from "node:assert/strict";
import { PhotoInspectionInput, PhotoInspectionResult, PHOTO_INSPECTION_DISCLAIMER, envelope } from "../src/contracts";
import { POST } from "../src/app/api/inspect/route";

const validInput = {
  demandId: "demand-1",
  imageRefs: ["upload://photo-1", "upload://photo-2"],
};

test("照片检查输入接受需求 ID 和非空图片引用列表", () => {
  const parsed = PhotoInspectionInput.parse(validInput);
  assert.deepEqual(parsed, validInput);
});

test("照片检查输入拒绝空引用、重复引用、超量和未知字段", () => {
  assert.equal(PhotoInspectionInput.safeParse({ ...validInput, imageRefs: [] }).success, false);
  assert.equal(PhotoInspectionInput.safeParse({ ...validInput, imageRefs: [" "] }).success, false);
  assert.equal(PhotoInspectionInput.safeParse({ ...validInput, imageRefs: ["same", "same"] }).success, false);
  assert.equal(PhotoInspectionInput.safeParse({ ...validInput, imageRefs: Array.from({ length: 11 }, (_, index) => `photo-${index}`) }).success, false);
  assert.equal(PhotoInspectionInput.safeParse({ ...validInput, providerId: "provider-a" }).success, false);
});

test("照片检查结果契约保留疑点、严重程度、时间和固定免责声明", () => {
  const result = PhotoInspectionResult.parse({
    demandId: validInput.demandId,
    findings: [{ imageRef: "upload://photo-1", severity: "medium", message: "局部反光，建议补拍。" }],
    reviewedAt: "2026-11-14T10:00:00.000Z",
    disclaimer: PHOTO_INSPECTION_DISCLAIMER,
  });
  const response = envelope(PhotoInspectionResult).parse({ ok: true, data: result, meta: { source: "live" } });
  assert.equal(response.data.findings[0].severity, "medium");
  assert.equal(response.data.disclaimer, PHOTO_INSPECTION_DISCLAIMER);
});

test("照片检查结果不允许写成验收结论", () => {
  assert.equal(PhotoInspectionResult.safeParse({
    demandId: validInput.demandId,
    findings: [],
    disclaimer: "已验收合格",
  }).success, false);
});

test("POST /api/inspect 先拒绝非同源请求，不读取照片正文", async () => {
  const badJson = await POST(new Request("http://localhost/api/inspect", {
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json" },
  }));
  assert.equal(badJson.status, 403);
  assert.equal((await badJson.json()).error.code, "FORBIDDEN");

  const invalid = await POST(new Request("http://localhost/api/inspect", {
    method: "POST",
    body: JSON.stringify({ demandId: "demand-1", imageRefs: [] }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(invalid.status, 403);
  assert.equal((await invalid.json()).error.code, "FORBIDDEN");
});

test("POST /api/inspect 对匿名合法 JSON 返回 401，不能绕过照片权限", async () => {
  const response = await POST(new Request("http://localhost/api/inspect", {
    method: "POST",
    body: JSON.stringify(validInput),
    headers: { "content-type": "application/json", origin: "http://localhost" },
  }));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.deepEqual(body.ok, false);
  assert.equal(body.error.code, "UNAUTHENTICATED");
  assert.ok(!("data" in body));
  assert.ok(!("meta" in body));
});
