import { createHash, randomUUID } from "node:crypto";
import type { InspectionImage, Prisma, PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { INSPECTION_UPLOAD_LIMITS as limits, InspectionImageRef, InspectionUploadedImage, InspectionUploadFields,
  InspectionUploadResult, PhotoInspectionInput, PhotoInspectionResult, PHOTO_INSPECTION_DISCLAIMER, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const writableStates = ["published", "contracted", "in_progress", "completed"];
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "请上传符合数量、格式、尺寸和大小限制的不重复 JPEG/PNG 照片。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有照片操作权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  IMAGE_NOT_FOUND: { status: 404, message: "照片引用不存在、已过期或不可访问，请重新上传。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能上传或检查照片。" },
  INVALID_STATE: { status: 409, message: "需求发布后才能上传或检查照片。" },
  IMAGE_QUOTA_EXCEEDED: { status: 409, message: "照片存储配额不足，请等待有效期结束或联系维护者。" },
  IMAGE_UPLOAD_BUSY: { status: 429, message: "照片处理暂时繁忙，请稍后重试。" },
  NOT_IMPLEMENTED: { status: 501, message: "照片引用有效，但辅助分析尚未接通，未生成检查或验收结论。" },
  INSPECTION_UNAVAILABLE: { status: 503, message: "照片检查模式配置无效，请联系维护者核实。" },
  IMAGE_STORAGE_UNAVAILABLE: { status: 503, message: "暂时无法确认照片存储状态，请稍后核实；重传会产生新引用。" },
} as const;
class ImageRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  return Response.json({ ok: false, error: { code, message: failures[code].message } } satisfies ApiFailure,
    { status: failures[code].status, headers });
}
function rejected(error: unknown) {
  if (error instanceof ImageRejected) return failure(error.code);
  if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
  return failure("IMAGE_STORAGE_UNAVAILABLE");
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient, expected?: string) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new ImageRejected("UNAUTHENTICATED");
  if (expected !== undefined && identity.userId !== expected) throw new ImageRejected("FORBIDDEN");
  return identity;
}
async function ownedDemand(tx: Prisma.TransactionClient, demandId: string, ownerId: string) {
  const row = await tx.demandOrder.findFirst({ where: { id: demandId, ownerId }, select: { id: true, ownerId: true, status: true } });
  if (!row) throw new ImageRejected("DEMAND_NOT_FOUND");
  if (row.id !== demandId || row.ownerId !== ownerId) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
  if (row.id === DEMO_DEMAND_ID) throw new ImageRejected("DEMO_DEMAND_READ_ONLY");
  if (!writableStates.includes(row.status)) throw new ImageRejected("INVALID_STATE");
  return row;
}
async function readBytes(request: Request, maxBytes: number) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new ImageRejected("VALIDATION_ERROR");
  if (!request.body) throw new ImageRejected("VALIDATION_ERROR");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ImageRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
async function multipart(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new ImageRejected("VALIDATION_ERROR");
  const bytes = await readBytes(request, limits.maxBodyBytes);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw new ImageRejected("VALIDATION_ERROR"); }
  if ([...form.keys()].some(key => key !== "demandId" && key !== "images") || form.getAll("demandId").length !== 1) {
    throw new ImageRejected("VALIDATION_ERROR");
  }
  const fields = InspectionUploadFields.safeParse({ demandId: form.get("demandId") });
  if (!fields.success) throw new ImageRejected("VALIDATION_ERROR");
  const files = form.getAll("images");
  if (!files.length || files.length > limits.maxFiles) throw new ImageRejected("VALIDATION_ERROR");
  let total = 0;
  const images = files.map(file => {
    if (typeof file === "string" || !["image/jpeg", "image/png"].includes(file.type) || file.size <= 0 || file.size > limits.maxFileBytes) {
      throw new ImageRejected("VALIDATION_ERROR");
    }
    total += file.size;
    return file;
  });
  if (total > limits.maxBatchBytes) throw new ImageRejected("VALIDATION_ERROR");
  return { ...fields.data, images };
}
function digest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function pngAnimated(bytes: Buffer) {
  // libpng may expose only APNG's first frame. Reject its animation control chunk explicitly.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new ImageRejected("VALIDATION_ERROR");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IEND") break;
    offset += length + 12;
  }
  return false;
}
async function normalize(file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  const format = file.type === "image/jpeg" ? "jpeg" : "png";
  const signature = format === "jpeg" ? input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff
    : input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!signature || (format === "png" && pngAnimated(input))) throw new ImageRejected("VALIDATION_ERROR");
  const decoder = sharp(input, { failOn: "warning", limitInputPixels: limits.maxPixels, sequentialRead: true }).timeout({ seconds: 5 });
  try {
    const metadata = await decoder.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height
      || metadata.width > limits.maxDimension || metadata.height > limits.maxDimension
      || metadata.width * metadata.height > limits.maxPixels) throw new ImageRejected("VALIDATION_ERROR");
    // No keepMetadata/withMetadata: only the decoded pixels survive re-encoding.
    const { data, info } = await decoder.rotate().toFormat(format).toBuffer({ resolveWithObject: true });
    if (!data.length || data.length > limits.maxFileBytes || info.width > limits.maxDimension || info.height > limits.maxDimension
      || info.width * info.height > limits.maxPixels) throw new ImageRejected("VALIDATION_ERROR");
    return { bytes: new Uint8Array(data), sha256: digest(data), originalHash: digest(input),
      contentType: file.type, sizeBytes: data.length, width: info.width, height: info.height };
  } catch { throw new ImageRejected("VALIDATION_ERROR"); }
  finally { decoder.destroy(); }
}
function receipt(row: InspectionImage) {
  if (row.sizeBytes !== row.bytes.byteLength || row.sha256 !== digest(row.bytes)) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
  return InspectionUploadedImage.parse({ imageRef: row.id, contentType: row.contentType, sizeBytes: row.sizeBytes,
    width: row.width, height: row.height, expiresAt: row.expiresAt.toISOString() });
}
async function quota(tx: Prisma.TransactionClient, ownerId: string, now: Date, count: number, bytes: number) {
  const owner = await tx.inspectionImage.aggregate({ where: { ownerId, expiresAt: { gt: now } }, _count: { _all: true }, _sum: { sizeBytes: true } });
  const global = await tx.inspectionImage.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } });
  for (const [usage, maxCount, maxBytes] of [[owner, limits.ownerFiles, limits.ownerBytes], [global, limits.globalFiles, limits.globalBytes]] as const) {
    const size = usage._sum.sizeBytes ?? 0;
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(usage._count._all) || usage._count._all < 0) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
    if (usage._count._all + count > maxCount || size + bytes > maxBytes) throw new ImageRejected("IMAGE_QUOTA_EXCEEDED");
  }
}

let activeUploads = 0;
/** Real storage only. Identity, ownership, quotas and the complete batch commit together. */
export async function handleInspectionUpload(request: Request, db: Database = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    if (activeUploads >= 2) return failure("IMAGE_UPLOAD_BUSY");
    activeUploads++;
    try {
      const input = await multipart(request);
      await db.$transaction(async tx => {
        const current = await requireOwner(request, tx, expected.userId);
        await ownedDemand(tx, input.demandId, current.userId);
      }, { isolationLevel: "Serializable" });
      const normalized: Awaited<ReturnType<typeof normalize>>[] = [];
      let total = 0;
      for (const file of input.images) {
        const image = await normalize(file);
        if (normalized.some(previous => previous.originalHash === image.originalHash || previous.sha256 === image.sha256)) throw new ImageRejected("VALIDATION_ERROR");
        total += image.sizeBytes;
        if (total > limits.maxBatchBytes) throw new ImageRejected("VALIDATION_ERROR");
        normalized.push(image);
      }
      const body = await db.$transaction(async tx => {
        const current = await requireOwner(request, tx, expected.userId);
        const demand = await ownedDemand(tx, input.demandId, current.userId);
        const now = new Date();
        // Reclaim expired bytes across owners before counting global storage; rollback with the upload on any failure.
        await tx.inspectionImage.deleteMany({ where: { expiresAt: { lte: now } } });
        await quota(tx, current.userId, now, normalized.length, total);
        const expiresAt = new Date(now.getTime() + limits.ttlSeconds * 1000);
        const images = normalized.map(image => ({ id: `inspect-image/${randomUUID()}`, ownerId: current.userId, expiresAt,
          contentType: image.contentType, sizeBytes: image.sizeBytes, width: image.width, height: image.height,
          bytes: image.bytes, sha256: image.sha256 }));
        await tx.demandOrder.update({ where: { id: demand.id, ownerId: current.userId, status: demand.status },
          data: { inspectionImages: { create: images } }, select: { id: true } });
        const rows = await tx.inspectionImage.findMany({ where: { id: { in: images.map(image => image.id) }, demandId: demand.id, ownerId: current.userId } });
        const result = images.map(image => {
          const row = rows.find(row => row.id === image.id);
          if (!row || row.ownerId !== current.userId || row.demandId !== demand.id || row.sha256 !== image.sha256
            || row.contentType !== image.contentType || row.width !== image.width || row.height !== image.height
            || row.expiresAt.getTime() !== expiresAt.getTime()) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
          return receipt(row);
        });
        if (rows.length !== images.length) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
        return envelope(InspectionUploadResult).parse({ ok: true, data: { demandId: demand.id, images: result }, meta: { source: "live" } });
      }, { isolationLevel: "Serializable" });
      return Response.json(body, { status: 201, headers });
    } finally { activeUploads--; }
  } catch (error) { return rejected(error); }
}

/** Validate stored references before returning an explicitly simulated result; live analysis is not connected. */
export async function handlePhotoInspection(request: Request, db: Database = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const bytes = await readBytes(request, 32768);
    let json: unknown;
    try { json = JSON.parse(bytes.toString("utf8")); } catch { throw new ImageRejected("INVALID_JSON"); }
    const input = PhotoInspectionInput.safeParse(json);
    if (!input.success) throw new ImageRejected("VALIDATION_ERROR");
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx, expected.userId);
      const demand = await ownedDemand(tx, input.data.demandId, current.userId);
      if (input.data.imageRefs.some(ref => !InspectionImageRef.safeParse(ref).success)) throw new ImageRejected("IMAGE_NOT_FOUND");
      const now = new Date();
      const rows = await tx.inspectionImage.findMany({ where: { id: { in: input.data.imageRefs }, ownerId: current.userId,
        demandId: demand.id, expiresAt: { gt: now } } });
      if (rows.length !== input.data.imageRefs.length) throw new ImageRejected("IMAGE_NOT_FOUND");
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
      for (const row of rows) {
        if (!input.data.imageRefs.includes(row.id) || row.ownerId !== current.userId || row.demandId !== demand.id
          || row.expiresAt.getTime() <= now.getTime()) throw new ImageRejected("IMAGE_STORAGE_UNAVAILABLE");
        receipt(row);
      }
      const mode = process.env.AI_MODE ?? "mock";
      if (mode === "live") throw new ImageRejected("NOT_IMPLEMENTED");
      if (mode !== "mock") throw new ImageRejected("INSPECTION_UNAVAILABLE");
      // Fixed demonstration text, never inferred from the stored pixels or a model.
      return envelope(PhotoInspectionResult).parse({ ok: true, data: {
        demandId: demand.id,
        findings: input.data.imageRefs.map(imageRef => ({ imageRef, severity: "low",
          message: "【模拟】未分析照片内容。本条仅演示辅助检查提示：请人工核实关键细节是否清晰，必要时补拍近景和不同角度；不代表发现缺陷或施工合格。" })),
        reviewedAt: now.toISOString(), disclaimer: PHOTO_INSPECTION_DISCLAIMER,
      }, meta: { source: "mock" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) { return rejected(error); }
}
