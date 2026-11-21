"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DemoProviderLogin } from "./DemoProviderLogin";
import { OwnerLogin } from "./OwnerLogin";
import { StaffLogin } from "./StaffLogin";

/**
 * 顶栏右侧的登录状态入口：业主账号与演示服务方登录收进同一个浮层。
 * 浮层关闭时组件仍保持挂载，会话刷新与到期检查照常运行。
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(false);
  const [staff,setStaff]=useState(false);
  const [admin,setAdmin]=useState(false);
  const onStaff=useCallback((v:boolean)=>setStaff(v),[]);
  const onAdmin=useCallback((v:boolean)=>setAdmin(v),[]);
  const [provider, setProvider] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]);
  const onOwner = useCallback((signedIn: boolean) => setOwner(signedIn), []);
  const onProvider = useCallback((signedIn: boolean) => setProvider(signedIn), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const label = admin ? "平台运营已登录" : staff ? "服务方已登录" : owner && provider ? "业主与演示服务方已登录" : owner ? "业主已登录" : provider ? "演示服务方已登录" : "未登录";
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
        className="inline-flex items-center gap-2 rounded-control border border-line bg-white px-3 py-2 text-[14px] font-medium text-ink-2 hover:border-brand hover:text-brand"
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${owner || provider ? "bg-brand" : "bg-ink-3"}`} />
        {label}
        <span aria-hidden="true" className={`text-[11px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-[calc(100%+8px)] z-30 max-h-[75vh] overflow-y-auto w-[min(360px,calc(100vw-32px))] rounded-card border border-line bg-white p-4 shadow-float"
      >
        <OwnerLogin onStatusChange={onOwner} />
        <StaffLogin role="provider" onStatusChange={onStaff}/>
        <StaffLogin role="admin" onStatusChange={onAdmin}/>
        <hr className="my-4 border-0 border-t border-line" />
        <DemoProviderLogin onStatusChange={onProvider} />
      </div>
    </div>
  );
}
