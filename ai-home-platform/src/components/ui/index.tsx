import React, { type ReactNode } from "react";
import Link from "next/link";

/** D 维护的跨角色共享 UI 出口；A/B/C 通过这里复用，避免跨 features 导入。 */

/** 色板 v2：石灰白底、松绿主色、扶手木强调；与 tailwind.config.ts 保持一致 */
export const T = {
  brand: "#815600",
  brandHover: "#654200",
  brandSoft: "#FFF0BE",
  accent: "#855C23",
  accentSoft: "#FFF3D6",
  wood: "#855C23",
  woodSoft: "#FFF3D6",
  seal: "#BF3A2B",
  ink: "#302A21",
  ink2: "#5D5345",
  muted: "#756A59",
  line: "#E9DFC9",
  surface: "#FFFFFF",
  canvas: "#FFFCF5",
  danger: "#A8261F",
  dangerSoft: "#FBEDEB",
  warn: "#7A5205",
  warnSoft: "#FBF3E2",
} as const;

/* ---------- 类名常量：其他三位可直接复用 ----------
 * 字号阶梯：页面标题 30 / 区块标题 18 / 正文 16 / 标签与按钮 14 / 辅助信息 13（最小）。
 * 静态卡片只用 1px 边线，不加阴影；阴影只留给浮层。 */
export const C = {
  card: "rounded-card border border-line bg-white p-6",
  cardFlush: "rounded-card border border-line bg-white",
  sectionTitle: "text-[18px] font-semibold leading-[1.5] text-ink",
  pageTitle: "text-[30px] font-bold leading-[1.3] text-ink",
  pageSub: "max-w-[38em] text-[16px] leading-[1.75] text-ink-2",
  meta: "text-[13px] leading-[1.5] text-ink-3",

  btnBase:
    "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-control border border-transparent px-5 py-2.5 text-[15px] font-medium leading-none no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-45",
  btnPrimary: "bg-[#F2C84B] text-[#302A21] hover:bg-[#E5B832]",
  btnSecondary:
    "border-line bg-white text-ink hover:border-brand hover:text-brand",
  btnGhost: "text-brand hover:bg-brand-soft",
  btnDanger: "border-danger/25 bg-white text-danger hover:bg-danger-soft",
  btnSm: "px-3.5 py-2 text-[14px]",

  pill: "inline-flex items-center rounded-full border border-line bg-white px-3 py-1 text-[13px] text-ink-2 hover:border-brand hover:text-brand",

  badge: "inline-flex items-center gap-1 rounded-tag px-2 py-0.5 text-[13px] font-medium leading-[1.6]",
  badgeBrand: "bg-brand-soft text-brand-hover",
  badgeAccent: "bg-wood-soft text-wood",
  badgeNeutral: "bg-mist text-ink-2",
  badgeDanger: "bg-danger-soft text-danger",

  label: "grid gap-1.5 text-[14px]",
  labelText: "font-medium text-ink-2",
  input:
    "w-full rounded-input border border-line bg-white px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/15",

  note: "rounded-control px-4 py-3 text-[14px] leading-relaxed",
  noteWarn: "bg-warn-soft text-warn",
  noteInfo: "bg-mist text-ink-2",
  noteDanger: "bg-danger-soft text-danger",
  noteOk: "bg-brand-soft text-brand-hover",
} as const;

/* ---------- 基础组件 ---------- */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`${C.card} ${className}`}>{children}</section>;
}

export function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className={`!mb-0 ${C.sectionTitle}`}>{title}</h2>
      {aside}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "brand" | "accent" | "neutral" | "danger";
}) {
  const map = {
    brand: C.badgeBrand,
    accent: C.badgeAccent,
    neutral: C.badgeNeutral,
    danger: C.badgeDanger,
  } as const;
  return <span className={`${C.badge} ${map[tone]}`}>{children}</span>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const map: Record<ButtonVariant, string> = {
    primary: C.btnPrimary,
    secondary: C.btnSecondary,
    ghost: C.btnGhost,
    danger: C.btnDanger,
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${C.btnBase} ${map[variant]} ${size === "sm" ? C.btnSm : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={C.label}>
      <span className={C.labelText}>
        {label}
        {hint ? <span className="ml-1 font-normal text-ink-3">（{hint}）</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Note({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title?: string;
  children: ReactNode;
}) {
  const map = {
    info: C.noteInfo,
    warn: C.noteWarn,
    danger: C.noteDanger,
    ok: C.noteOk,
  } as const;
  return (
    <div className={`${C.note} ${map[tone]}`} role={tone === "danger" ? "alert" : "status"}>
      {title ? <p className="!mb-1 font-semibold">{title}</p> : null}
      <div className="[&>p:last-child]:!mb-0">{children}</div>
    </div>
  );
}

/** 空状态：一句话说明 + 一个动作，避免出现纯空白区域 */
export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 rounded-card border border-dashed border-line bg-white px-4 py-10 text-center">
      <p className="!mb-0 text-[16px] font-medium text-ink-2">{title}</p>
      {hint ? <p className={`!mb-0 ${C.meta}`}>{hint}</p> : null}
      {action}
    </div>
  );
}
/** 页面头部：标题 + 一句说明 + 右侧动作。所有业务页统一用它开屏。 */
export function PageHeader({
  title,
  subtitle,
  aside,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 id={id} className={`!mb-1 ${C.pageTitle}`}>{title}</h1>
        {subtitle ? <p className={`!mb-0 ${C.pageSub}`}>{subtitle}</p> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}

/** 长得像按钮的链接（<a> 内不套 <button>）。 */
export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  className?: string;
}) {
  const map: Record<ButtonVariant, string> = {
    primary: C.btnPrimary,
    secondary: C.btnSecondary,
    ghost: C.btnGhost,
    danger: C.btnDanger,
  };
  return (
    <Link href={href} className={`${C.btnBase} ${map[variant]} ${size === "sm" ? C.btnSm : ""} ${className}`}>
      {children}
    </Link>
  );
}

/**
 * 折叠的说明：数据来源、权限边界、演示限制等静态长文案放这里。
 * 内容始终在 HTML 中（不删信息，只降级显示）；summary 本身要一句话说清是什么。
 * 会随加载状态变化、需要读屏播报的内容（role="status" / aria-live）不要放进来。
 */
export function Explainer({
  summary = "数据来源与使用说明",
  children,
  className = "",
}: {
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group my-4 rounded-control border border-line bg-white text-[14px] leading-relaxed text-ink-2 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-[11px] text-ink-3 transition-transform group-open:rotate-90">▶</span>
        {summary}
      </summary>
      <div className="border-t border-line px-4 py-3 [&>p:last-child]:!mb-0 [&>p]:!mb-2">{children}</div>
    </details>
  );
}

export { FulfillmentRuler, SealStamp, FULFILLMENT_STAGES, stageIndexOf, completedStageCount, newlyStampedFrom } from "./FulfillmentRuler";
