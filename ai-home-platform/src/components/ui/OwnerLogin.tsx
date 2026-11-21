"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { OwnerLoginInput, OwnerSessionState, type OwnerLoginInputDTO, type OwnerSessionStateDTO } from "@/contracts";
import { ApiClientError, apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { Badge, Button, C } from "@/components/ui";

type Action = "GET" | "POST" | "DELETE";
export type OwnerLoginState = { session: OwnerSessionStateDTO | null; pending: boolean; error: string | null };
const endpoint = "/api/auth/owner";

export async function requestOwnerSession(action: Action, input?: OwnerLoginInputDTO) {
  const result = action === "GET" ? await apiGet(endpoint, OwnerSessionState)
    : action === "POST" ? await apiPost(endpoint, OwnerLoginInput.parse(input), OwnerSessionState)
      : await apiDelete(endpoint, OwnerSessionState);
  const source = "meta" in result ? result.meta.source : result.source;
  if (source !== "live" || (action === "POST" && result.data.status !== "signed_in")
    || (action === "DELETE" && result.data.status !== "signed_out")) {
    throw new ApiClientError("业主登录状态不符合约定。", "INVALID_RESPONSE", 200);
  }
  return result.data;
}

export function OwnerSessionView({ state, onAction }: {
  state: OwnerLoginState; onAction: (action: Action, input?: OwnerLoginInputDTO) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const signedIn = !state.pending && !state.error && state.session?.status === "signed_in";
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = OwnerLoginInput.safeParse({ login, password });
    setPassword("");
    if (!parsed.success) { setInputError("账号需 3–64 位字母、数字或 ._-，密码需 6–128 字符。"); return; }
    setInputError(null);
    onAction("POST", parsed.data);
  }
  return <section aria-label="业主账号登录">
    <div>
      <div className="grid gap-3">
        <div className="text-[14px] leading-relaxed text-ink-2">
          <div className="flex flex-wrap items-center gap-2 text-ink">
            <Badge tone={signedIn ? "brand" : "neutral"}>业主账号</Badge>
            <span role="status" aria-live="polite">{state.pending ? "正在确认业主登录状态…" : state.error ? "业主登录状态未确认"
              : signedIn ? "已登录" : "尚未登录业主账号"}</span>
          </div>
          <p className="!mb-0 mt-1.5 text-[13px] text-ink-3">发布需求前请登录。暂未开放注册，可向演示负责人领取账号。</p>
          <p className="!mb-0 mt-1 text-[13px] text-ink-3">切换角色不会自动登录，账号尚未实名认证。</p>
          {signedIn && state.session?.status === "signed_in" && <p className="!mb-0 mt-1 text-[13px]">有效至 <time dateTime={state.session.expiresAt}>
            {new Date(state.session.expiresAt).toLocaleString("zh-CN")}</time>，到期需重新登录。</p>}
          {state.error && <p role="alert" className="!mb-0 mt-1 text-danger">{state.error}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {signedIn ? <Button size="sm" variant="secondary" onClick={() => onAction("DELETE")}>退出业主登录</Button>
            : <Button size="sm" disabled={state.pending} onClick={() => { setExpanded(value => !value); setPassword(""); setInputError(null); }}>
              {expanded ? "收起登录" : "业主登录"}</Button>}
          <Button size="sm" variant="ghost" disabled={state.pending} onClick={() => onAction("GET")}>刷新业主状态</Button>
        </div>
      </div>
      {expanded && !signedIn && <form onSubmit={submit} className="mt-3 grid gap-3" aria-label="业主登录表单">
        <label className={C.label}><span className={C.labelText}>账号</span><input className={C.input} name="username" autoComplete="username"
          required minLength={3} maxLength={64} disabled={state.pending} value={login} onChange={e => setLogin(e.target.value)} /></label>
        <label className={C.label}><span className={C.labelText}>密码</span><input className={C.input} name="password" type="password" autoComplete="current-password"
          required minLength={6} maxLength={128} disabled={state.pending} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <Button type="submit" disabled={state.pending}>登录业主账号</Button>
        {inputError && <p role="alert" className="!mb-0 text-[14px] text-danger">{inputError}</p>}
      </form>}
    </div>
  </section>;
}

export function OwnerLogin({ onStatusChange }: { onStatusChange?: (signedIn: boolean) => void } = {}) {
  const [state, setState] = useState<OwnerLoginState>({ session: null, pending: true, error: null });
  const requests = useRef({ active: true, busy: false, version: 0 });
  const run = useCallback(async (action: Action, input?: OwnerLoginInputDTO) => {
    const control = requests.current;
    if (control.busy) return;
    const version = ++control.version;
    control.busy = true;
    setState({ session: null, pending: true, error: null });
    try {
      const session = await requestOwnerSession(action, input);
      if (control.active && version === control.version) setState({ session, pending: false, error: null });
    } catch (error) {
      const message = error instanceof ApiClientError && error.code === "INVALID_CREDENTIALS" ? "账号或密码不正确，请重新输入。"
        : error instanceof ApiClientError && error.status === 429 ? "登录尝试过于频繁，请稍后重试。"
          : error instanceof ApiClientError && error.status === 403 ? "请从本站的安全连接登录（本地开发可用 localhost）。"
            : "无法确认业主登录状态，请刷新状态后重试。";
      if (control.active && version === control.version) setState({ session: null, pending: false, error: message });
    } finally { if (version === control.version) control.busy = false; }
  }, []);
  useEffect(() => {
    const control = requests.current;
    control.active = true;
    const refresh = () => { void run("GET"); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); control.active = false; control.busy = false; control.version++; };
  }, [run]);
  useEffect(() => {
    if (state.session?.status !== "signed_in") return;
    const timer = window.setTimeout(() => { void run("GET"); }, Math.min(86400000, Math.max(1000, Date.parse(state.session.expiresAt) - Date.now() + 50)));
    return () => window.clearTimeout(timer);
  }, [state.session, run]);
  const signedIn = !state.pending && !state.error && state.session?.status === "signed_in";
  useEffect(() => { onStatusChange?.(signedIn); }, [signedIn, onStatusChange]);
  return <OwnerSessionView state={state} onAction={(action, input) => { void run(action, input); }} />;
}
