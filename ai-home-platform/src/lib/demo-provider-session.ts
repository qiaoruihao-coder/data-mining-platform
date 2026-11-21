import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID, type DemoProviderSessionDTO, type VerifiedSessionDTO } from "@/contracts";
import { prisma } from "@/lib/prisma";
import {readStaffSession,staffCookie} from "@/lib/staff-auth";

export const DEMO_SESSION_COOKIE = "ai_home_demo_session";
export const DEMO_SESSION_TTL_SECONDS = 30 * 60;
type SessionDatabase = Pick<Prisma.TransactionClient, "demoProviderSession">;

export function demoAuthEnabled() {
  return process.env.DEMO_AUTH_ENABLED === "true";
}

export function isSameOrigin(request: Request) {
  const url = new URL(request.url);
  // NextURL normalizes loopback IPs to localhost; Host retains the browser's actual authority.
  // Do not accept forwarded host headers or fall back to the normalized host after a mismatch.
  const host = request.headers.get("host") ?? url.host;
  return request.headers.get("origin") === `${url.protocol}//${host}`
    && request.headers.get("sec-fetch-site") !== "cross-site";
}

function tokenHash(request: Request): string | null {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(`${DEMO_SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(DEMO_SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}

/** The opaque token proves possession; current account binding is checked on every read. */
export async function readDemoSession(
  request: Request,
  db: SessionDatabase = prisma,
  now = new Date(),
): Promise<Extract<DemoProviderSessionDTO, { status: "signed_in" }> | null> {
  if (!demoAuthEnabled()) return null;
  if (!["GET", "HEAD"].includes(request.method) && !isSameOrigin(request)) return null;
  const hash = tokenHash(request);
  if (!hash) return null;
  const row = await db.demoProviderSession.findUnique({
    where: { tokenHash: hash },
    include: { user: { include: { provider: { select: { id: true } } } } },
  });
  if (!row || row.expiresAt.getTime() <= now.getTime()
    || row.userId !== DEMO_PROVIDER_USER_ID || row.providerId !== DEMO_PROVIDER_ID
    || row.user.role !== "provider" || row.user.providerId !== row.providerId
    || row.user.provider?.id !== row.providerId) return null;
  return {
    status: "signed_in", demo: true,
    identity: { userId: DEMO_PROVIDER_USER_ID, role: "provider", providerId: DEMO_PROVIDER_ID },
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Pass the current transaction client when used by B's atomic quote kernel. */
export async function readDemoVerifiedSession(
  request: Request,
  db: SessionDatabase = prisma,
): Promise<VerifiedSessionDTO | null> {
  if ((request.headers.get("cookie")??"").split(";").some(x=>x.trim().startsWith(staffCookie("provider")+"="))) {
    if (!("ownerSession" in db)) return null;
    return (await readStaffSession(request, db as Prisma.TransactionClient, "provider"))?.identity ?? null;
  }
  return (await readDemoSession(request, db))?.identity ?? null;
}

export class DemoAccountUnavailable extends Error {}

export async function issueDemoSession(request: Request, db: PrismaClient = prisma, now = new Date()) {
  if (!demoAuthEnabled() || !isSameOrigin(request)) throw new DemoAccountUnavailable();
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const previous = tokenHash(request);
  const expiresAt = new Date(now.getTime() + DEMO_SESSION_TTL_SECONDS * 1000);
  await db.$transaction(async tx => {
    const account = await tx.user.findUnique({
      where: { id: DEMO_PROVIDER_USER_ID }, include: { provider: { select: { id: true } } },
    });
    if (account?.role !== "provider" || account.providerId !== DEMO_PROVIDER_ID
      || account.provider?.id !== DEMO_PROVIDER_ID) throw new DemoAccountUnavailable();
    if (previous) await tx.demoProviderSession.deleteMany({ where: { tokenHash: previous } });
    await tx.demoProviderSession.deleteMany({ where: { expiresAt: { lte: now } } });
    await tx.demoProviderSession.create({ data: {
      tokenHash: hash, userId: DEMO_PROVIDER_USER_ID, providerId: DEMO_PROVIDER_ID, expiresAt,
    } });
  });
  const data: DemoProviderSessionDTO = {
    status: "signed_in", demo: true,
    identity: { userId: DEMO_PROVIDER_USER_ID, role: "provider", providerId: DEMO_PROVIDER_ID },
    expiresAt: expiresAt.toISOString(),
  };
  return { token, data };
}

export async function revokeDemoSession(request: Request, db: SessionDatabase = prisma) {
  const hash = tokenHash(request);
  if (hash) await db.demoProviderSession.deleteMany({ where: { tokenHash: hash } });
}
