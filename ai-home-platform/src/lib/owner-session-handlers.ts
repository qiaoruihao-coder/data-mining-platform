import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { OwnerLoginInput, OwnerSessionState, envelope, type ApiFailure, type OwnerSessionStateDTO } from "@/contracts";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { issueOwnerSession, OWNER_SESSION_COOKIE, OwnerAccessError, readOwnerSessionState, revokeOwnerSession } from "@/lib/owner-auth";
import { PasswordCapacityError, verifyOwnerPassword } from "@/lib/owner-password";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const failures = {
  FORBIDDEN: [403, "请使用当前站点的安全连接操作业主登录。"],
  VALIDATION_ERROR: [400, "账号或密码格式不正确，请检查输入。"],
  INVALID_CREDENTIALS: [401, "账号或密码不正确。"],
  RATE_LIMITED: [429, "登录尝试过于频繁，请稍后重试。"],
  SESSION_UNAVAILABLE: [503, "暂时无法确认业主登录状态，请刷新后重试。"],
} as const;
class InvalidCredentials extends Error {}
function failure(code: keyof typeof failures, retryAfter?: number) {
  const [status, message] = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, {
    status, headers: { ...headers, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}
function success(data: OwnerSessionStateDTO) {
  return Response.json(envelope(OwnerSessionState).parse({ ok: true, data, meta: { source: "live" } }), { headers });
}
function secureOrigin(request: Request) {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const authority = request.headers.get("host") ?? url.host;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(`http://${authority}`).hostname);
  } catch { return false; }
}
async function readInput(request: Request) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new Error("Body too large");
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return OwnerLoginInput.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function failureKey(login: string) {
  // Legacy buckets included successes; do not inherit their lockouts after upgrading.
  return `failure:${createHash("sha256").update(login).digest("hex")}`;
}
async function loginRetryAfter(db: Pick<PrismaClient, "ownerLoginAttempt">, key: string, now: Date) {
  const previous = await db.ownerLoginAttempt.findUnique({ where: { key } });
  return previous && previous.count >= 5 && previous.resetsAt > now
    ? Math.max(1, Math.ceil((previous.resetsAt.getTime() - now.getTime()) / 1000)) : null;
}
/** Only rejected credentials consume this account's budget, never another account's. */
async function recordFailure(db: PrismaClient, key: string, now: Date) {
  return db.$transaction(async tx => {
    await tx.ownerLoginAttempt.deleteMany({ where: { resetsAt: { lte: now } } });
    const retryAfter = await loginRetryAfter(tx, key, now);
    if (retryAfter) return retryAfter;
    await tx.ownerLoginAttempt.upsert({ where: { key },
      create: { key, count: 1, resetsAt: new Date(now.getTime() + 15 * 60_000) }, update: { count: { increment: 1 } } });
    return null;
  }, { isolationLevel: "Serializable" });
}

export function createOwnerSessionHandlers(db: PrismaClient = prisma, clock = () => new Date()) {
  return {
    async GET(request: Request) {
      if (!secureOrigin(request)) return failure("FORBIDDEN");
      try {
        const state = await db.$transaction(tx => readOwnerSessionState(request, tx, clock()), { isolationLevel: "Serializable" });
        return success(state);
      } catch (error) {
        return error instanceof OwnerAccessError && error.code === "FORBIDDEN"
          ? success({ status: "signed_out" }) : failure("SESSION_UNAVAILABLE");
      }
    },
    async POST(request: Request) {
      if (!secureOrigin(request) || !isSameOrigin(request)) return failure("FORBIDDEN");
      let input;
      try { input = await readInput(request); } catch { return failure("VALIDATION_ERROR"); }
      const key = failureKey(input.login);
      try {
        const retryAfter = await loginRetryAfter(db, key, clock());
        if (retryAfter) return failure("RATE_LIMITED", retryAfter);
        const credential = await db.ownerCredential.findUnique({ where: { login: input.login } });
        const verified = await verifyOwnerPassword(input.password, credential?.passwordHash ?? null);
        if (!verified || !credential) throw new InvalidCredentials();
        const result = await db.$transaction(async tx => {
          const retryAfter = await loginRetryAfter(tx, key, clock());
          if (retryAfter) return { retryAfter };
          const current = await tx.ownerCredential.findUnique({ where: { login: input.login }, include: { user: true } });
          if (!current || current.userId !== credential.userId || current.passwordHash !== credential.passwordHash || current.user.role !== "owner") {
            throw new InvalidCredentials();
          }
          const identity = { userId: current.userId, role: "owner" as const, providerId: null };
          await revokeOwnerSession(request, tx, clock());
          const issued = await issueOwnerSession(identity, tx, clock());
          await tx.ownerLoginAttempt.deleteMany({ where: { key } });
          const data = OwnerSessionState.parse({ status: "signed_in", identity, expiresAt: issued.expiresAt.toISOString() });
          return { data, cookie: issued.cookie };
        }, { isolationLevel: "Serializable" });
        if ("retryAfter" in result) return failure("RATE_LIMITED", result.retryAfter);
        const response = success(result.data);
        response.headers.set("Set-Cookie", result.cookie);
        return response;
      } catch (error) {
        if (error instanceof InvalidCredentials) {
          try {
            const retryAfter = await recordFailure(db, key, clock());
            return retryAfter ? failure("RATE_LIMITED", retryAfter) : failure("INVALID_CREDENTIALS");
          } catch { return failure("SESSION_UNAVAILABLE"); }
        }
        if (error instanceof PasswordCapacityError) return failure("RATE_LIMITED", 1);
        return failure("SESSION_UNAVAILABLE");
      }
    },
    async DELETE(request: Request) {
      if (!secureOrigin(request) || !isSameOrigin(request)) return failure("FORBIDDEN");
      try {
        await db.$transaction(tx => revokeOwnerSession(request, tx, clock()), { isolationLevel: "Serializable" });
        const response = success({ status: "signed_out" });
        response.headers.set("Set-Cookie", `${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        return response;
      } catch { return failure("SESSION_UNAVAILABLE"); }
    },
  };
}
