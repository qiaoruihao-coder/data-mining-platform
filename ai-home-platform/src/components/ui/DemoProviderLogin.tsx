"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DemoProviderLoginInput, DemoProviderSession, type DemoProviderSessionDTO } from "@/contracts";
import { ApiClientError, apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { Badge, Button } from "@/components/ui";

type SessionAction = "GET" | "POST" | "DELETE";
export type DemoLoginState = { session: DemoProviderSessionDTO | null; pending: boolean; error: string | null };
const endpoint = "/api/auth/demo-provider";

export async function requestDemoProviderSession(action: SessionAction): Promise<DemoProviderSessionDTO> {
  const result = action === "GET" ? await apiGet(endpoint, DemoProviderSession)
    : action === "POST" ? await apiPost(endpoint, DemoProviderLoginInput.parse({ action: "login_demo" }), DemoProviderSession)
      : await apiDelete(endpoint, DemoProviderSession);
  const source = "meta" in result ? result.meta.source : result.source;
  if (source !== "mock" || (action === "POST" && result.data.status !== "signed_in")
    || (action === "DELETE" && result.data.status === "signed_in")) {
    throw new ApiClientError("演示会话返回状态不符合约定。", "INVALID_RESPONSE", 200);
  }
  return result.data;
}

export function DemoProviderSessionView({ state, onAction }: { state: DemoLoginState; onAction: (action: SessionAction) => void }) {
  const session = state.session;
  return <section aria-label="演示服务方登录">
    <div className="grid gap-3">
      <div className="text-[14px] leading-relaxed text-ink-2">
        <div className="flex flex-wrap items-center gap-2 text-ink">
          <Badge tone="accent">模拟身份 · 演示专用</Badge>
          <span role="status" aria-live="polite">
            {state.pending ? "正在确认演示登录状态…" : state.error ? "演示登录状态未确认"
              : session?.status === "signed_in" ? `已登录：演示服务方（${session.identity.providerId}）`
                : session?.status === "disabled" ? "演示登录未开启，请联系维护者。" : "尚未登录演示服务方"}
          </span>
        </div>
        <p className="!mb-0 mt-1.5 text-[13px] text-ink-3">演示账号不代表真实身份认证。切换角色不会自动登录。</p>
        {session?.status === "signed_in" && !state.pending && !state.error && <p className="!mb-0 mt-1 text-[13px]">
          有效至 <time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleTimeString("zh-CN")}</time>；报价是否提交成功以接口回执为准。
        </p>}
        {state.error && <p role="alert" className="!mb-0 mt-1 text-danger">{state.error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {session?.status === "signed_out" && !state.error && <Button size="sm" disabled={state.pending} onClick={() => onAction("POST")}>演示服务方登录</Button>}
        {session?.status === "signed_in" && !state.error && <>
          <Link href="/provider" className="rounded-input px-2 py-1.5 text-[14px] font-medium text-brand">进入需求大厅</Link>
          <Button size="sm" variant="secondary" disabled={state.pending} onClick={() => onAction("DELETE")}>退出演示登录</Button>
        </>}
        <Button size="sm" variant="ghost" disabled={state.pending} onClick={() => onAction("GET")}>刷新登录状态</Button>
      </div>
    </div>
  </section>;
}

export function DemoProviderLogin({ onStatusChange }: { onStatusChange?: (signedIn: boolean) => void } = {}) {
  const [state, setState] = useState<DemoLoginState>({ session: null, pending: true, error: null });
  const requests = useRef({ active: true, busy: false, version: 0 });
  const run = useCallback(async (action: SessionAction) => {
    const control = requests.current;
    if (control.busy) return;
    const version = ++control.version;
    control.busy = true;
    setState({ session: null, pending: true, error: null });
    try {
      const session = await requestDemoProviderSession(action);
      if (control.active && version === control.version) setState({ session, pending: false, error: null });
    } catch (error) {
      const message = error instanceof ApiClientError && error.code === "DEMO_ACCOUNT_UNAVAILABLE"
        ? "演示账号未准备好，请联系维护者检查演示数据。"
        : "无法确认演示登录状态，请刷新状态后重试。";
      if (control.active && version === control.version) setState({ session: null, pending: false, error: message });
    } finally {
      if (version === control.version) control.busy = false;
    }
  }, []);

  useEffect(() => {
    const control = requests.current;
    control.active = true;
    const refresh = () => { void run("GET"); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      control.active = false;
      control.busy = false;
      control.version++;
    };
  }, [run]);
  useEffect(() => {
    if (state.session?.status !== "signed_in") return;
    const delay = Math.max(1000, Date.parse(state.session.expiresAt) - Date.now() + 50);
    const timer = window.setTimeout(() => { void run("GET"); }, delay);
    return () => window.clearTimeout(timer);
  }, [state.session, run]);
  const signedIn = !state.pending && !state.error && state.session?.status === "signed_in";
  useEffect(() => { onStatusChange?.(signedIn); }, [signedIn, onStatusChange]);
  return <DemoProviderSessionView state={state} onAction={action => { void run(action); }} />;
}
