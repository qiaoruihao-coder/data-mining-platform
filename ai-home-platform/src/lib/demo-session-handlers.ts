import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { DemoProviderLoginInput, DemoProviderSession, type ApiFailure, type DemoProviderSessionDTO } from "@/contracts";
import { prisma } from "@/lib/prisma";
import {
  DEMO_SESSION_COOKIE, DEMO_SESSION_TTL_SECONDS, DemoAccountUnavailable,
  demoAuthEnabled, isSameOrigin, issueDemoSession, readDemoSession, revokeDemoSession,
} from "@/lib/demo-provider-session";

const noCache = { "Cache-Control": "no-store", Vary: "Cookie" };
const success = (data: DemoProviderSessionDTO) => NextResponse.json({
  ok: true, data: DemoProviderSession.parse(data), meta: { source: "mock" },
}, { headers: noCache });
const failure = (status: number, code: string, message: string) => NextResponse.json({
  ok: false, error: { code, message },
} satisfies ApiFailure, { status, headers: noCache });
function setCookie(response: NextResponse, request: Request, token: string, maxAge: number) {
  response.cookies.set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge,
  });
  return response;
}

export function createDemoSessionHandlers(db: PrismaClient = prisma, clock = () => new Date()) {
  return {
    async GET(request: Request) {
      if (!demoAuthEnabled()) return success({ status: "disabled", demo: true });
      try {
        return success(await readDemoSession(request, db, clock()) ?? { status: "signed_out", demo: true });
      } catch {
        return failure(503, "SESSION_UNAVAILABLE", "演示会话暂时无法读取，请稍后重试。");
      }
    },
    async POST(request: Request) {
      if (!isSameOrigin(request)) return failure(403, "FORBIDDEN", "请从当前站点发起演示登录。");
      if (!demoAuthEnabled()) return failure(403, "DEMO_AUTH_DISABLED", "演示登录尚未开启。");
      let input: unknown;
      try { input = await request.json(); } catch {
        return failure(400, "INVALID_JSON", "请求不是有效 JSON。");
      }
      if (!DemoProviderLoginInput.safeParse(input).success) return failure(400, "VALIDATION_ERROR", "只能登录预设的演示服务方账号。");
      try {
        const { token, data } = await issueDemoSession(request, db, clock());
        return setCookie(success(data), request, token, DEMO_SESSION_TTL_SECONDS);
      } catch (error) {
        return error instanceof DemoAccountUnavailable
          ? failure(503, "DEMO_ACCOUNT_UNAVAILABLE", "演示账号未准备好，请维护者检查演示数据和账号绑定。")
          : failure(503, "SESSION_UNAVAILABLE", "演示登录暂时不可用，请稍后重试。");
      }
    },
    async DELETE(request: Request) {
      if (!isSameOrigin(request)) return failure(403, "FORBIDDEN", "请从当前站点退出演示登录。");
      try {
        await revokeDemoSession(request, db);
        return setCookie(success({ status: demoAuthEnabled() ? "signed_out" : "disabled", demo: true }), request, "", 0);
      } catch {
        return failure(503, "SESSION_UNAVAILABLE", "无法确认演示会话已退出，请稍后重试。");
      }
    },
  };
}
