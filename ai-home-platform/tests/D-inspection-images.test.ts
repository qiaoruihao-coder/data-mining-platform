import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import sharp from "sharp";
import { INSPECTION_UPLOAD_LIMITS as limits, InspectionUploadFields, InspectionUploadResult,
  PhotoInspectionResult, PHOTO_INSPECTION_DISCLAIMER, envelope } from "../src/contracts";
import { handleInspectionUpload, handlePhotoInspection } from "../src/lib/inspection-images";
import { handleDemandDelete } from "../src/lib/demand-delete";
import { issueOwnerSession, OWNER_SESSION_COOKIE } from "../src/lib/owner-auth";

const origin = "https://localhost:3000";
type Database = Pick<PrismaClient, "$transaction">;
type ImageFile = { bytes: Uint8Array; type: string; name?: string };
function uploadRequest(cookie: string, demandId: string, files: ImageFile[], change?: (form: FormData) => void) {
  const form = new FormData(); form.set("demandId", demandId);
  for (const file of files) form.append("images", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name ?? "private-original-name.png");
  change?.(form);
  return new Request(`${origin}/api/inspect/images`, { method: "POST", headers: { origin, cookie }, body: form });
}
function inspectRequest(cookie: string, body: unknown) {
  return new Request(`${origin}/api/inspect`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function checked(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  const raw = await response.json();
  assert.doesNotMatch(JSON.stringify(raw), /private-original-name|ownerId|tokenHash|sha256|private database|bytes":/);
  if (status === 201) return envelope(InspectionUploadResult).parse(raw);
  if (status === 200) {
    const result = envelope(PhotoInspectionResult).parse(raw);
    assert.equal(result.meta.source, "mock");
    assert.equal(result.data.disclaimer, PHOTO_INSPECTION_DISCLAIMER);
    for (const finding of result.data.findings) assert.match(finding.message, /【模拟】未分析照片内容/);
    return result;
  }
  assert.equal(raw.ok, false); assert.equal(raw.error.code, code); assert.equal("data" in raw, false); assert.equal("meta" in raw, false);
  return raw;
}
function decorate(db: PrismaClient, transform: (tx: Prisma.TransactionClient, count: number) => Promise<Prisma.TransactionClient>): Database {
  let count = 0;
  return { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
    assert.equal(options.isolationLevel, "Serializable"); count++;
    return db.$transaction(async tx => run(await transform(tx, count)), options);
  } } as unknown as Database;
}
const image = (width = 20, height = 10, background = "#3174ab") => sharp({ create: { width, height, channels: 3, background } });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("上传公共契约限制来源、引用、尺寸、批量和额外字段", () => {
  assert.equal(InspectionUploadFields.parse({ demandId: " one " }).demandId, " one ");
  for (const value of [{ demandId: " " }, { demandId: "one", ownerId: "owner" }]) assert.equal(InspectionUploadFields.safeParse(value).success, false);
  const entry = { imageRef: `inspect-image/${randomUUID()}`, contentType: "image/png", sizeBytes: 80, width: 20, height: 10, expiresAt: new Date().toISOString() };
  assert.ok(InspectionUploadResult.safeParse({ demandId: "one", images: [entry] }).success);
  for (const patch of [{ imageRef: "filename.png" }, { imageRef: "https://private.invalid/img" }, { sizeBytes: 0 }, { sizeBytes: limits.maxFileBytes + 1 },
    { width: 4097 }, { width: 4096, height: 4096 }, { expiresAt: "tomorrow" }, { contentType: "image/svg+xml" }, { ownerId: "owner" }]) {
    assert.equal(InspectionUploadResult.safeParse({ demandId: "one", images: [{ ...entry, ...patch }] }).success, false);
  }
  for (const entries of [[], [entry, entry], Array.from({ length: 6 }, () => ({ ...entry, imageRef: `inspect-image/${randomUUID()}`, sizeBytes: limits.maxFileBytes }))]) {
    assert.equal(InspectionUploadResult.safeParse({ demandId: "one", images: entries }).success, false);
  }
});

test("照片存储：隔离 SQLite、真实解码、归属、引用和事务回滚", async t => {
  const originalMode = process.env.AI_MODE;
  t.after(() => { if (originalMode === undefined) delete process.env.AI_MODE; else process.env.AI_MODE = originalMode; });
  const tempRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(tempRoot, "ai-home-D-images-"));
  const path = join(fixture, "images.db");
  const databaseUrl = `file:${path.replaceAll("\\", "/")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await db.$disconnect();
    assert.equal(dirname(resolve(fixture)), tempRoot); assert.ok(basename(fixture).startsWith("ai-home-D-images-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  writeFileSync(path, "");
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 30000,
  });
  await db.user.createMany({ data: ["one", "two"].map(id => ({ id, name: `Synthetic ${id}`, role: "owner" })) });
  const issued = await db.$transaction(tx => issueOwnerSession({ userId: "one", role: "owner", providerId: null }, tx));
  const cookie = issued.cookie.split(";")[0];
  const tokenHash = hash(Buffer.from(cookie.slice(OWNER_SESSION_COOKIE.length + 1)));
  const otherCookie = (await db.$transaction(tx => issueOwnerSession({ userId: "two", role: "owner", providerId: null }, tx))).cookie.split(";")[0];
  const png: ImageFile = { bytes: await image().png().toBuffer(), type: "image/png" };
  const jpeg: ImageFile = { bytes: await image(12, 24).jpeg().withMetadata({ orientation: 6 }).toBuffer(), type: "image/jpeg" };
  t.beforeEach(async () => {
    process.env.AI_MODE = "mock";
    await db.user.update({ where: { id: "one" }, data: { role: "owner" } });
    await db.ownerSession.update({ where: { tokenHash }, data: { userId: "one", revokedAt: null, expiresAt: issued.expiresAt } });
    await db.inspectionImage.deleteMany(); await db.demandOrder.deleteMany();
    await db.demandOrder.createMany({ data: ["one", "alt", "other", "demo-demand", " one ", "draft"].map(id => ({ id, ownerId: id === "other" ? "two" : "one",
      description: "Synthetic upload demand", city: "Test", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 1000,
      desiredDays: 10, renovationType: "repair", status: id === "draft" ? "draft" : "published" })) });
  });
  const upload = (files = [png], id = "one", credential = cookie, client: Database = db) => handleInspectionUpload(uploadRequest(credential, id, files), client);
  const inspect = (refs: string[], id = "one", credential = cookie, client: Database = db) => handlePhotoInspection(inspectRequest(credential, { demandId: id, imageRefs: refs }), client);
  const saved = async () => (await checked(await upload(), 201)).data.images[0].imageRef as string;

  await t.test("PNG/JPEG 真实重编码去元数据、旋转、回执无路径，上传 live 与检查 mock 区分", async () => {
    const before = Date.now();
    const response = await checked(await upload([png, jpeg]), 201);
    assert.equal(response.meta.source, "live"); assert.equal(response.data.demandId, "one");
    const rows = await db.inspectionImage.findMany(); assert.equal(rows.length, 2);
    for (const item of response.data.images) {
      const row = rows.find(row => row.id === item.imageRef)!;
      assert.equal(row.ownerId, "one"); assert.equal(row.demandId, "one");
      assert.equal(row.bytes.byteLength, item.sizeBytes); assert.equal(row.sha256, hash(row.bytes));
      assert.ok(Date.parse(item.expiresAt) >= before + limits.ttlSeconds * 1000);
      assert.ok(Date.parse(item.expiresAt) <= Date.now() + limits.ttlSeconds * 1000);
      const metadata = await sharp(row.bytes).metadata();
      assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.icc, undefined);
      assert.equal(metadata.orientation, undefined); assert.equal(metadata.width, item.width); assert.equal(metadata.height, item.height);
      if (item.contentType === "image/jpeg") { assert.equal(item.width, 24); assert.equal(item.height, 12); assert.notDeepEqual(row.bytes, jpeg.bytes); }
    }
    await checked(await inspect(response.data.images.map((entry: { imageRef: string }) => entry.imageRef)), 200);
    assert.equal(await db.inspectionImage.count(), 2);
    assert.equal((await db.demandOrder.findUniqueOrThrow({ where: { id: "one" } })).status, "published");
    assert.equal((await checked(await upload(), 201)).meta.source, "live"); assert.equal(await db.inspectionImage.count(), 3, "separate uploads do not deduplicate");
  });

  await t.test("格式伪装、坏图片、SVG、动画、空文件与重复批次全部不落库", async () => {
    const animated = Buffer.concat([Buffer.from(png.bytes).subarray(0, 33), Buffer.from([0,0,0,8]), Buffer.from("acTL"), Buffer.alloc(12), Buffer.from(png.bytes).subarray(33)]);
    for (const files of [
      [{ bytes: new Uint8Array(), type: "image/png" }], [{ bytes: Buffer.from("<svg></svg>"), type: "image/png" }],
      [{ ...png, type: "image/jpeg" }], [{ ...jpeg, type: "image/png" }], [{ ...png, type: "image/svg+xml" }],
      [{ bytes: png.bytes.subarray(0, 40), type: "image/png" }], [{ bytes: jpeg.bytes.subarray(0, 80), type: "image/jpeg" }],
      [{ bytes: animated, type: "image/png" }], [png, png], [png, { bytes: Buffer.from("broken"), type: "image/png" }],
    ]) { await checked(await upload(files), 400, "VALIDATION_ERROR"); assert.equal(await db.inspectionImage.count(), 0); }
    const withMetadata: ImageFile = { ...png, bytes: await image().png().withMetadata().toBuffer() };
    await checked(await upload([png, withMetadata]), 400, "VALIDATION_ERROR");
    assert.equal(await db.inspectionImage.count(), 0);
  });

  await t.test("数量、文件/批次/正文长度、字段和尺寸边界在保存前拒绝", async () => {
    for (const files of [[], Array.from({ length: 11 }, () => png), [{ ...png, bytes: Buffer.alloc(limits.maxFileBytes + 1) }],
      Array.from({ length: 6 }, () => ({ ...png, bytes: Buffer.alloc(Math.floor(limits.maxBatchBytes / 6) + 1) }))]) {
      await checked(await upload(files), 400, "VALIDATION_ERROR");
    }
    for (const change of [(form: FormData) => form.append("ownerId", "two"), (form: FormData) => form.append("demandId", "alt"),
      (form: FormData) => form.set("images", "filename.png"), (form: FormData) => form.set("demandId", " ")]) {
      await checked(await handleInspectionUpload(uploadRequest(cookie, "one", [png], change), db), 400, "VALIDATION_ERROR");
    }
    for (const [width, height] of [[4097, 1], [4096, 4096]]) {
      await checked(await upload([{ ...png, bytes: await image(width, height).png().toBuffer() }]), 400, "VALIDATION_ERROR");
    }
    const body = new Uint8Array(limits.maxBodyBytes + 1);
    await checked(await handleInspectionUpload(new Request(`${origin}/api/inspect/images`, { method: "POST", headers: { origin, cookie,
      "content-type": "multipart/form-data; boundary=test" }, body }), db), 400, "VALIDATION_ERROR");
    const oversizedHeader = uploadRequest(cookie, "one", [png]); oversizedHeader.headers.set("content-length", String(limits.maxBodyBytes + 1));
    await checked(await handleInspectionUpload(oversizedHeader, db), 400, "VALIDATION_ERROR");
    const badMultipart = new Request(`${origin}/api/inspect/images`, { method: "POST", headers: { origin, cookie, "content-type": "multipart/form-data; boundary=bad" }, body: "broken" });
    await checked(await handleInspectionUpload(badMultipart, db), 400, "VALIDATION_ERROR");
    assert.equal(await db.inspectionImage.count(), 0);
    assert.equal((await checked(await upload([{ ...png, bytes: await image(4096, 1).png().toBuffer() }]), 201)).data.images[0].width, 4096);
  });

  await t.test("同源与真实业主优先，匿名/失效/重复凭证不消费正文，角色改变拒绝", async () => {
    for (const credential of ["", `${OWNER_SESSION_COOKIE}=bad`, `${cookie}; ${cookie}`, "ai_home_demo_session=forged"]) {
      const request = uploadRequest(credential, "one", [png]);
      await checked(await handleInspectionUpload(request, db), 401, "UNAUTHENTICATED"); assert.equal(request.bodyUsed, false);
      await checked(await inspect([`inspect-image/${randomUUID()}`], "one", credential), 401, "UNAUTHENTICATED");
    }
    for (const headers of [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }]) {
      const request = uploadRequest(cookie, "one", [png]); for (const [key, value] of Object.entries(headers)) request.headers.set(key, value!);
      await checked(await handleInspectionUpload(request, db), 403, "FORBIDDEN"); assert.equal(request.bodyUsed, false);
    }
    await db.ownerSession.update({ where: { tokenHash }, data: { expiresAt: new Date(0) } }); await checked(await upload(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { expiresAt: issued.expiresAt, revokedAt: new Date() } }); await checked(await upload(), 401, "UNAUTHENTICATED");
    await db.ownerSession.update({ where: { tokenHash }, data: { revokedAt: null } });
    await db.user.update({ where: { id: "one" }, data: { role: "admin" } }); await checked(await upload(), 403, "FORBIDDEN");
    assert.equal(await db.inspectionImage.count(), 0);
  });

  await t.test("需求精确匹配、跨业主/不存在统一 404；demo/draft 只读，合法后续状态可保存", async () => {
    const missing = await checked(await upload([png], "missing"), 404, "DEMAND_NOT_FOUND");
    assert.deepEqual(await checked(await upload([png], "other"), 404, "DEMAND_NOT_FOUND"), missing);
    await checked(await upload([png], "demo-demand"), 409, "DEMO_DEMAND_READ_ONLY");
    await checked(await upload([png], "draft"), 409, "INVALID_STATE");
    assert.equal((await checked(await upload([png], " one "), 201)).data.demandId, " one ");
    for (const status of ["contracted", "in_progress", "completed"]) {
      await db.demandOrder.update({ where: { id: "one" }, data: { status } }); await checked(await upload(), 201);
    }
  });

  await t.test("引用拒绝文件名/URL、未知、跨需求、跨业主、过期、混合缺失；损坏数据 503", async () => {
    const ref = await saved();
    for (const refs of [["photo.jpg"], ["https://example.invalid/private"], [`inspect-image/${randomUUID()}`], [ref, `inspect-image/${randomUUID()}`]]) {
      await checked(await inspect(refs), 404, "IMAGE_NOT_FOUND");
    }
    await checked(await inspect([ref], "alt"), 404, "IMAGE_NOT_FOUND");
    await checked(await inspect([ref], "other", otherCookie), 404, "IMAGE_NOT_FOUND");
    await checked(await inspect([ref], "one", otherCookie), 404, "DEMAND_NOT_FOUND");
    await db.inspectionImage.update({ where: { id: ref }, data: { expiresAt: new Date(0) } });
    await checked(await inspect([ref]), 404, "IMAGE_NOT_FOUND");
    await db.inspectionImage.update({ where: { id: ref }, data: { expiresAt: new Date(Date.now() + 60000), sha256: "broken" } });
    await checked(await inspect([ref]), 503, "IMAGE_STORAGE_UNAVAILABLE");
    assert.equal(await db.inspectionImage.count(), 1);
  });

  await t.test("检查 JSON/查询限制，已授权有效引用才返回 mock", async () => {
    const ref = await saved();
    for (const body of [{ demandId: "one", imageRefs: [] }, { demandId: "one", imageRefs: [ref, ref] }, { demandId: "one", imageRefs: [ref], ownerId: "one" }]) {
      await checked(await handlePhotoInspection(inspectRequest(cookie, body), db), 400, "VALIDATION_ERROR");
    }
    for (const body of ["{", "x".repeat(32769)]) {
      await checked(await handlePhotoInspection(new Request(`${origin}/api/inspect`, { method: "POST", headers: { origin, cookie }, body }), db), 400,
        body.length > 32768 ? "VALIDATION_ERROR" : "INVALID_JSON");
    }
    for (const handler of [handlePhotoInspection, handleInspectionUpload]) await checked(await handler(new Request(`${origin}/api/inspect?ownerId=one`,
      { method: "POST", headers: { origin, cookie } }), db), 400, "VALIDATION_ERROR");
    await checked(await inspect([ref]), 200);
  });

  await t.test("mock 逐个绑定输入引用和顺序、生成时间及免责声明，整个数据库业务快照不变", async () => {
    const files = await Promise.all(Array.from({ length: 10 }, async (_, i) => ({
      type: "image/png", bytes: await image(20 + i, 10).png().toBuffer(),
    })));
    const uploaded = await checked(await upload(files), 201);
    const refs = uploaded.data.images.map((item: { imageRef: string }) => item.imageRef).reverse();
    const snapshot = () => db.$transaction(async tx => ({
      demands: await tx.demandOrder.findMany(), images: await tx.inspectionImage.findMany(),
      orders: await tx.serviceOrder.findMany(), schedules: await tx.schedule.findMany(),
      payments: await tx.payment.findMany(), tickets: await tx.ticket.findMany(), reviews: await tx.review.findMany(),
    }));
    const before = await snapshot();
    const started = Date.now();
    for (const subset of [[refs[0]], refs]) {
      const result = await checked(await inspect(subset), 200);
      assert.equal(result.data.demandId, "one");
      assert.deepEqual(result.data.findings.map((item: { imageRef: string }) => item.imageRef), subset);
      assert.ok(result.data.findings.every((item: { severity: string }) => item.severity === "low"));
      assert.ok(Date.parse(result.data.reviewedAt) >= started && Date.parse(result.data.reviewedAt) <= Date.now());
    }
    assert.deepEqual(await snapshot(), before);
    await checked(await inspect([...refs, `inspect-image/${randomUUID()}`]), 400, "VALIDATION_ERROR");
  });

  await t.test("未设置模式默认 mock；live 明确 501，非法模式 503，均不降级或绕过授权与存储校验", async () => {
    const ref = await saved();
    delete process.env.AI_MODE;
    await checked(await inspect([ref]), 200);
    for (const mode of ["live", "", "LIVE", "invalid"]) {
      process.env.AI_MODE = mode;
      await checked(await inspect([ref]), mode === "live" ? 501 : 503, mode === "live" ? "NOT_IMPLEMENTED" : "INSPECTION_UNAVAILABLE");
      await checked(await inspect([ref], "one", ""), 401, "UNAUTHENTICATED");
      await checked(await inspect([ref], "one", otherCookie), 404, "DEMAND_NOT_FOUND");
      await checked(await inspect([`inspect-image/${randomUUID()}`]), 404, "IMAGE_NOT_FOUND");
    }
    await db.inspectionImage.update({ where: { id: ref }, data: { sha256: "broken" } });
    for (const mode of ["mock", "live", "invalid"]) {
      process.env.AI_MODE = mode;
      await checked(await inspect([ref]), 503, "IMAGE_STORAGE_UNAVAILABLE");
    }
  });

  await t.test("解码前后均重验会话/角色/归属/状态；最终 SQL 再限制，失败全部回滚", async () => {
    for (const phase of [2, 3]) for (const [change, status, code] of [
      [async (tx: Prisma.TransactionClient) => { await tx.ownerSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } }); }, 401, "UNAUTHENTICATED"],
      [async (tx: Prisma.TransactionClient) => { await tx.ownerSession.update({ where: { tokenHash }, data: { userId: "two" } }); }, 403, "FORBIDDEN"],
      [async (tx: Prisma.TransactionClient) => { await tx.user.update({ where: { id: "one" }, data: { role: "provider" } }); }, 403, "FORBIDDEN"],
      [async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "two" } }); }, 404, "DEMAND_NOT_FOUND"],
      [async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { status: "draft" } }); }, 409, "INVALID_STATE"],
    ] as const) {
      const client = decorate(db, async (tx, count) => { if (count === phase) await change(tx); return tx; });
      await checked(await upload([png], "one", cookie, client), status, code); assert.equal(await db.inspectionImage.count(), 0);
    }
    const changedAtWrite = decorate(db, async (tx, count) => count !== 3 ? tx : ({ ...tx, demandOrder: { ...tx.demandOrder,
      update: async (args: Prisma.DemandOrderUpdateArgs) => {
        assert.deepEqual(args.where, { id: "one", ownerId: "one", status: "published" });
        await tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "two" } }); return tx.demandOrder.update(args);
      },
    } }) as unknown as Prisma.TransactionClient);
    await checked(await upload([png, jpeg], "one", cookie, changedAtWrite), 503, "IMAGE_STORAGE_UNAVAILABLE");
    assert.equal(await db.inspectionImage.count(), 0);
  });

  await t.test("持久化输出错误回滚整批及过期清理；存储故障不伪装 mock 或 501", async () => {
    const ref = await saved(); await db.inspectionImage.update({ where: { id: ref }, data: { expiresAt: new Date(0) } });
    const otherRef = `inspect-image/${randomUUID()}`;
    await db.inspectionImage.create({ data: { ...await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } }),
      id: otherRef, ownerId: "two", demandId: "other" } });
    const corrupt = decorate(db, async (tx, count) => count !== 3 ? tx : ({ ...tx, inspectionImage: { ...tx.inspectionImage,
      findMany: async (args: Prisma.InspectionImageFindManyArgs) => (await tx.inspectionImage.findMany(args)).map(row => ({ ...row, width: 0 })),
    } }) as unknown as Prisma.TransactionClient);
    await checked(await upload([png, jpeg], "one", cookie, corrupt), 503, "IMAGE_STORAGE_UNAVAILABLE");
    assert.deepEqual((await db.inspectionImage.findMany()).map(row => row.id).sort(), [ref, otherRef].sort());
    const broken = { $transaction: async () => { throw new Error("private database"); } } as unknown as Database;
    await checked(await upload([png], "one", cookie, broken), 503, "IMAGE_STORAGE_UNAVAILABLE");
    await checked(await inspect([ref], "one", cookie, broken), 503, "IMAGE_STORAGE_UNAVAILABLE");
  });

  await t.test("检查引用同一事务重验授权与 SQL 范围，不接收跨归属或损坏的数据库结果", async () => {
    const ref = await saved();
    for (const [change, status, code] of [
      [async (tx: Prisma.TransactionClient) => { await tx.ownerSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } }); }, 401, "UNAUTHENTICATED"],
      [async (tx: Prisma.TransactionClient) => { await tx.ownerSession.update({ where: { tokenHash }, data: { userId: "two" } }); }, 403, "FORBIDDEN"],
      [async (tx: Prisma.TransactionClient) => { await tx.user.update({ where: { id: "one" }, data: { role: "provider" } }); }, 403, "FORBIDDEN"],
      [async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { ownerId: "two" } }); }, 404, "DEMAND_NOT_FOUND"],
      [async (tx: Prisma.TransactionClient) => { await tx.demandOrder.update({ where: { id: "one" }, data: { status: "draft" } }); }, 409, "INVALID_STATE"],
      [async (tx: Prisma.TransactionClient) => { await tx.inspectionImage.update({ where: { id: ref }, data: { expiresAt: new Date(0) } }); }, 404, "IMAGE_NOT_FOUND"],
    ] as const) {
      const changed = decorate(db, async (tx, count) => { if (count === 2) await change(tx); return tx; });
      await checked(await inspect([ref], "one", cookie, changed), status, code);
    }
    const row = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    for (const patch of [{ ownerId: "two" }, { demandId: "other" }, { id: `inspect-image/${randomUUID()}` },
      { sizeBytes: row.sizeBytes + 1 }, { expiresAt: new Date(0) }, { contentType: "image/svg+xml" }, { bytes: new Uint8Array([1]) }]) {
      const corrupt = decorate(db, async (tx, count) => count !== 2 ? tx : ({ ...tx, inspectionImage: { ...tx.inspectionImage,
        findMany: async (args: Prisma.InspectionImageFindManyArgs) => {
          assert.equal(args.where?.ownerId, "one"); assert.equal(args.where?.demandId, "one");
          assert.deepEqual(args.where?.id, { in: [ref] }); assert.ok(args.where?.expiresAt);
          return [{ ...row, ...patch }];
        },
      } }) as unknown as Prisma.TransactionClient);
      await checked(await inspect([ref], "one", cookie, corrupt), 503, "IMAGE_STORAGE_UNAVAILABLE");
    }
    await checked(await inspect([ref]), 200);
  });

  await t.test("到期仅引用失效，成功上传清理所有过期行并保留其他业主有效照片；删除需求级联照片", async () => {
    const ref = await saved(); const row = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    await db.inspectionImage.update({ where: { id: ref }, data: { expiresAt: new Date(0) } });
    const otherRef = `inspect-image/${randomUUID()}`;
    await db.inspectionImage.create({ data: { ...row, id: otherRef, ownerId: "two", demandId: "other", expiresAt: new Date(0) } });
    const active = await db.inspectionImage.create({ data: { ...row, id: `inspect-image/${randomUUID()}`, ownerId: "two", demandId: "other" } });
    await checked(await inspect([ref]), 404, "IMAGE_NOT_FOUND"); assert.equal(await db.inspectionImage.count(), 3);
    await checked(await upload(), 201);
    assert.equal(await db.inspectionImage.count({ where: { id: ref } }), 0); assert.equal(await db.inspectionImage.count({ where: { id: otherRef } }), 0);
    assert.deepEqual(await db.inspectionImage.findUniqueOrThrow({ where: { id: active.id } }), active);
    await checked(await inspect([active.id], "other", otherCookie), 200);
    const deleted = await handleDemandDelete(new Request(`${origin}/api/demand/one`, { method: "DELETE", headers: { origin, cookie } }), "one", db);
    assert.equal(deleted.status, 200); assert.equal(await db.inspectionImage.count({ where: { demandId: "one" } }), 0);
  });

  await t.test("其他业主过期照片填满全局数量后，上传实际清除内容并释放额度", async () => {
    const ref = await saved(); const active = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    await db.inspectionImage.createMany({ data: Array.from({ length: limits.globalFiles - 1 }, () => ({ ...active,
      id: `inspect-image/${randomUUID()}`, ownerId: "two", demandId: "other", expiresAt: new Date(0) })) });
    assert.equal(await db.inspectionImage.count(), limits.globalFiles);
    const result = await checked(await upload(), 201);
    assert.equal(result.meta.source, "live"); assert.equal(await db.inspectionImage.count(), 2);
    assert.equal(await db.inspectionImage.count({ where: { ownerId: "two" } }), 0);
    assert.deepEqual(await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } }), active);
    const remaining = await db.inspectionImage.aggregate({ _sum: { sizeBytes: true } });
    assert.equal(remaining._sum.sizeBytes, active.sizeBytes + result.data.images[0].sizeBytes);
  });

  await t.test("服务端同一时刻的过期边界：等于 now 清理，大于 now 保留", async () => {
    const ref = await saved(); const row = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    const ids = Array.from({ length: 3 }, () => `inspect-image/${randomUUID()}`);
    await db.inspectionImage.createMany({ data: ids.map(id => ({ ...row, id, ownerId: "two", demandId: "other" })) });
    const atBoundary = decorate(db, async (tx, count) => count !== 3 ? tx : ({ ...tx, inspectionImage: { ...tx.inspectionImage,
      deleteMany: async (args: Prisma.InspectionImageDeleteManyArgs) => {
        const now = (args.where?.expiresAt as Prisma.DateTimeFilter).lte; assert.ok(now instanceof Date);
        for (const [i, offset] of [-1, 0, 1].entries()) await tx.inspectionImage.update({ where: { id: ids[i] }, data: { expiresAt: new Date(now.getTime() + offset) } });
        return tx.inspectionImage.deleteMany(args);
      },
    } }) as unknown as Prisma.TransactionClient);
    await checked(await upload([png], "one", cookie, atBoundary), 201);
    assert.deepEqual((await db.inspectionImage.findMany({ where: { ownerId: "two" } })).map(entry => entry.id), [ids[2]]);
  });

  await t.test("非法或越权上传不触发清理，额度不足和清理故障全部回滚", async () => {
    const ref = await saved(); const row = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    const expired = await db.inspectionImage.create({ data: { ...row, id: `inspect-image/${randomUUID()}`, ownerId: "two", demandId: "other", expiresAt: new Date(0) } });
    await checked(await upload([png], "one", ""), 401, "UNAUTHENTICATED");
    await checked(await upload([png], "one", otherCookie), 404, "DEMAND_NOT_FOUND");
    await checked(await upload([{ ...png, bytes: Buffer.from("broken") }]), 400, "VALIDATION_ERROR");
    assert.deepEqual(await db.inspectionImage.findUniqueOrThrow({ where: { id: expired.id } }), expired);
    const brokenCleanup = decorate(db, async (tx, count) => count !== 3 ? tx : ({ ...tx, inspectionImage: { ...tx.inspectionImage,
      deleteMany: async (args: Prisma.InspectionImageDeleteManyArgs) => { await tx.inspectionImage.deleteMany(args); throw new Error("private database"); },
    } }) as unknown as Prisma.TransactionClient);
    await checked(await upload([png], "one", cookie, brokenCleanup), 503, "IMAGE_STORAGE_UNAVAILABLE");
    assert.equal(await db.inspectionImage.count(), 2);
    await db.inspectionImage.createMany({ data: Array.from({ length: limits.ownerFiles - 1 }, () => ({ ...row, id: `inspect-image/${randomUUID()}` })) });
    await checked(await upload(), 409, "IMAGE_QUOTA_EXCEEDED");
    assert.deepEqual(await db.inspectionImage.findUniqueOrThrow({ where: { id: expired.id } }), expired);
    assert.equal(await db.inspectionImage.count(), limits.ownerFiles + 1);
  });

  await t.test("两连接并发回收及上传仍共同受全局数量约束", async () => {
    const ref = await saved(); const row = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    await db.inspectionImage.createMany({ data: Array.from({ length: limits.globalFiles - 2 }, () => ({ ...row,
      id: `inspect-image/${randomUUID()}`, ownerId: "two", demandId: "other" })) });
    const expiredId = `inspect-image/${randomUUID()}`;
    await db.inspectionImage.create({ data: { ...row, id: expiredId, ownerId: "two", demandId: "other", expiresAt: new Date(0) } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const responses = await Promise.all([upload(), upload([jpeg], "one", cookie, second)]);
      assert.equal(responses.filter(response => response.status === 201).length, 1);
      assert.ok(responses.every(response => [201, 409, 503].includes(response.status)));
      assert.equal(await db.inspectionImage.count(), limits.globalFiles);
      assert.equal(await db.inspectionImage.count({ where: { id: expiredId } }), 0);
      await checked(await upload(), 409, "IMAGE_QUOTA_EXCEEDED");
    } finally { await second.$disconnect(); }
  });

  await t.test("业主数量配额并发不超额；全局数量/字节及业主字节均限制", async () => {
    const ref = await saved(); const row = await db.inspectionImage.findUniqueOrThrow({ where: { id: ref } });
    await db.inspectionImage.createMany({ data: Array.from({ length: 48 }, () => ({ ...row, id: `inspect-image/${randomUUID()}` })) });
    const responses = await Promise.all([upload(), upload()]);
    assert.ok(responses.every(response => [201, 409, 503].includes(response.status))); assert.ok(responses.some(response => response.status === 201));
    assert.equal(await db.inspectionImage.count(), 50);
    await checked(await upload(), 409, "IMAGE_QUOTA_EXCEEDED");
    await db.inspectionImage.deleteMany({ where: { id: { not: ref } } });
    for (const [global, usage] of [[false, { _count: { _all: 1 }, _sum: { sizeBytes: limits.ownerBytes } }],
      [true, { _count: { _all: limits.globalFiles }, _sum: { sizeBytes: 0 } }], [true, { _count: { _all: 1 }, _sum: { sizeBytes: limits.globalBytes } }]] as const) {
      const quotaClient = decorate(db, async (tx, count) => count !== 3 ? tx : ({ ...tx, inspectionImage: { ...tx.inspectionImage,
        aggregate: async (args: Prisma.InspectionImageAggregateArgs) => Boolean(args.where) !== global ? usage : tx.inspectionImage.aggregate(args),
      } }) as unknown as Prisma.TransactionClient);
      await checked(await upload([png], "one", cookie, quotaClient), 409, "IMAGE_QUOTA_EXCEEDED");
    }
    assert.equal(await db.inspectionImage.count(), 1);
  });

  await t.test("进程最多两个上传，繁忙返回 429，失败后释放名额", async () => {
    let reached = 0; let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const bothReady = new Promise<void>(resolve => { ready = resolve; });
    function delayed(): Database {
      let calls = 0;
      return { $transaction: async (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: "Serializable" }) => {
        calls++; if (calls === 2) { reached++; if (reached === 2) ready(); await gate; }
        return db.$transaction(run, options);
      } } as unknown as Database;
    }
    const pending = [upload([png], "missing", cookie, delayed()), upload([png], "missing", cookie, delayed())];
    try { await bothReady; await checked(await upload(), 429, "IMAGE_UPLOAD_BUSY"); }
    finally { release(); }
    for (const result of await Promise.all(pending)) await checked(result, 404, "DEMAND_NOT_FOUND");
    await checked(await upload(), 201);
  });
});
