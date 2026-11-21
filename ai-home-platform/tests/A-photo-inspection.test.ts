import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientError } from "../src/lib/api-client";
import { PHOTO_INSPECTION_DISCLAIMER } from "../src/contracts";
import { PhotoInspectionPanel } from "../src/features/a/PhotoInspectionPanel";
import {
  formatInspectionResult,
  photoInspectionSelectionError,
  photoInspectionStatus,
  submitPhotoInspection,
  uploadInspectionImages,
} from "../src/features/a/photo-inspection";

const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
before(() => Object.defineProperty(globalThis, "React", { configurable: true, value: React }));
after(() => {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
});

test("照片辅助检查首屏提示尚未选择照片，不显示固定来源徽章，并保留辅助检查说明", () => {
  const html = renderToStaticMarkup(createElement(PhotoInspectionPanel, { demandId: "d-1" }));
  assert.match(html, /照片辅助检查/);
  assert.doesNotMatch(html, /来源：未确认/);
  assert.match(html, /尚未选择照片，来源未确认/);
  assert.match(html, /只能提示疑点/);
  assert.match(html, /不能替代现场检测或证明施工合格/);
  assert.match(html, /当前不会自动确认验收/);
  assert.match(html, /disabled/);
});

test("照片检查状态覆盖等待、成功、失败和 501，不生成验收成功结论", () => {
  assert.match(photoInspectionStatus("idle", 0), /尚未选择照片/);
  assert.match(photoInspectionStatus("selected", 2), /已选择 2 张照片/);
  assert.match(photoInspectionStatus("submitting", 2), /等待接口返回/);
  assert.match(photoInspectionStatus("ready", 2), /已返回辅助检查结果/);
  const unavailable = photoInspectionStatus("unavailable", 2);
  assert.match(unavailable, /501/);
  assert.doesNotMatch(unavailable, /已验收|验收合格/);
  assert.match(photoInspectionStatus("failed", 2), /未完成/);
  assert.match(photoInspectionStatus("invalid", 11), /重新选择/);
});

test("超过 10 张或重复照片时给出可读选择提示，不泄露契约校验原文", () => {
  assert.equal(photoInspectionSelectionError(["one.jpg", "two.jpg"]), null);
  assert.match(photoInspectionSelectionError(Array.from({ length: 11 }, (_, index) => `photo-${index}.jpg`)) ?? "", /最多选择 10 张照片/);
  assert.match(photoInspectionSelectionError(["same.jpg", "same.jpg"]) ?? "", /不能重复/);
  assert.doesNotMatch(photoInspectionSelectionError(Array.from({ length: 11 }, (_, index) => `photo-${index}.jpg`)) ?? "", /Array must contain/);
});

test("照片提交通过 apiPost 发送需求 ID 和图片引用，并展示实际返回数据", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/inspect");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { demandId: "d-1", imageRefs: ["before.jpg"] });
    return Response.json({
      ok: true,
      data: {
        demandId: "d-1",
        findings: [{ imageRef: "before.jpg", severity: "medium", message: "画面有反光" }],
        disclaimer: PHOTO_INSPECTION_DISCLAIMER,
      },
      meta: { source: "mock" },
    });
  });
  const result = await submitPhotoInspection("d-1", ["before.jpg"]);
  assert.deepEqual(result, {
    data: {
      demandId: "d-1",
      findings: [{ imageRef: "before.jpg", severity: "medium", message: "画面有反光" }],
      disclaimer: PHOTO_INSPECTION_DISCLAIMER,
    },
    source: "mock",
  });
  assert.match(formatInspectionResult(result.data), /画面有反光/);
  assert.equal(request.mock.callCount(), 1);
});

test("照片上传使用 multipart 契约并保留服务端来源与短期引用", async (t) => {
  const imageRef = "inspect-image/123e4567-e89b-42d3-a456-426614174000";
  const file = new File([new Uint8Array([1, 2, 3])], "现场.png", { type: "image/png" });
  const request = t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    assert.equal(path, "/api/inspect/images");
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    const body = init?.body as FormData;
    assert.equal(body.get("demandId"), "d-1");
    assert.equal((body.get("images") as File).name, "现场.png");
    return Response.json({
      ok: true,
      data: {
        demandId: "d-1",
        images: [{ imageRef, contentType: "image/png", sizeBytes: 3, width: 1, height: 1, expiresAt: "2026-11-15T00:00:00.000Z" }],
      },
      meta: { source: "live" },
    }, { status: 201 });
  });
  const result = await uploadInspectionImages("d-1", [file]);
  assert.equal(result.source, "live");
  assert.equal(result.data.images[0]?.imageRef, imageRef);
  assert.equal(request.mock.callCount(), 1);
});

test("照片上传 401、501 和网络失败均保留真实失败，不产生图片引用", async (t) => {
  const file = new File([new Uint8Array([1])], "现场.png", { type: "image/png" });
  for (const [status, code, expected] of [
    [401, "UNAUTHENTICATED", /HTTP 401/],
    [403, "FORBIDDEN", /HTTP 403/],
    [501, "NOT_IMPLEMENTED", /HTTP 501/],
    [503, "IMAGE_STORAGE_UNAVAILABLE", /HTTP 503/],
  ] as const) {
    t.mock.method(globalThis, "fetch", async () => Response.json(
      { ok: false, error: { code, message: "测试失败" } }, { status },
    ));
    await assert.rejects(uploadInspectionImages("d-1", [file]), (cause: unknown) => {
      assert.ok(cause instanceof ApiClientError);
      assert.equal(cause.status, status);
      assert.match(cause.message, expected);
      return true;
    });
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(uploadInspectionImages("d-1", [file]), (cause: unknown) => {
    assert.ok(cause instanceof ApiClientError);
    assert.equal(cause.code, "NETWORK_ERROR");
    return true;
  });
});

test("200 成功信封但结果不符合公共契约时失败，不展示半成品", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ok: true,
    data: { demandId: "d-1", findings: [] },
    meta: { source: "mock" },
  }));
  await assert.rejects(
    submitPhotoInspection("d-1", ["before.jpg"]),
    (cause: unknown) => {
      assert.ok(cause instanceof ApiClientError);
      assert.equal(cause.code, "INVALID_RESPONSE");
      return true;
    },
  );
});

test("501 由 apiPost 传给页面，不变成空成功", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { ok: false, error: { code: "NOT_IMPLEMENTED", message: "这是开工骨架，此操作尚未实现。" } },
    { status: 501 },
  ));
  await assert.rejects(
    submitPhotoInspection("d-1", ["before.jpg"]),
    (cause: unknown) => {
      assert.ok(cause instanceof ApiClientError);
      assert.equal(cause.status, 501);
      assert.match(cause.message, /HTTP 501/);
      return true;
    },
  );
});
