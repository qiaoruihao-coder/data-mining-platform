/**
 * A 模块内的视觉基线（参考实现）。
 *
 * 为什么放在 features/a 而不是 globals.css / tailwind.config.ts：
 * 全局色板、layout、共享 ui 归 D（见 docs/OWNERSHIP.md），A 不得自行改写；
 * 但「模块内样式使用 Tailwind 或 CSS Module」，所以这里用 Tailwind 字面量类名沉淀一套
 * 可复制的 token + 基础组件，供 B/C/D 直接 import 或照抄，等 D 把 token 提到全局后，
 * 本文件的组件只需替换类名常量，调用方不用改。
 *
 * 约束：只写完整字面量类名，禁止拼接字符串，否则 Tailwind 扫描不到。
 */

import Link from "next/link";
import { C as SharedC, T as SharedT, PageHeader as SharedPageHeader } from "@/components/ui";

/** 色板与类名常量已统一到 D 的共享出口（视觉基线 v2），这里转出以保持原有调用方式。 */
export const T = SharedT;
export const C = SharedC;

/* ---------- 基础组件 ---------- */

/** 页面头部：标题 + 说明 + 右侧动作，统一所有业主端页面的开屏样式 */
export function PageHeader(props: { title: string; subtitle?: string; aside?: React.ReactNode }) {
  return <SharedPageHeader {...props} />;
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`${C.card} ${className}`}>{children}</section>;
}

export function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className={`!mb-0 ${C.sectionTitle}`}>{title}</h2>
      {aside}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
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

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: C.btnPrimary,
  secondary: C.btnSecondary,
  ghost: C.btnGhost,
  danger: C.btnDanger,
};

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${C.btnBase} ${BUTTON_VARIANT[variant]} ${size === "sm" ? C.btnSm : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * 长得像按钮的链接。
 *
 * 为什么不用 <Link><Button/></Link>：<a> 里套 <button> 是非法嵌套，
 * 键盘用户会落到两个可聚焦元素上，屏幕阅读器会念成「按钮 链接」。
 * 这里直接渲染成 <Link>（即 <a>），复用按钮的视觉类名。
 */
export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${C.btnBase} ${BUTTON_VARIANT[variant]} ${size === "sm" ? C.btnSm : ""} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
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
  children: React.ReactNode;
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
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 rounded-card border border-dashed border-line bg-white px-4 py-10 text-center">
      <p className="!mb-0 text-[16px] font-medium text-ink-2">{title}</p>
      {hint ? <p className={`!mb-0 ${C.meta}`}>{hint}</p> : null}
      {action}
    </div>
  );
}

/**
 * 数据披露（首屏静态）：无论接口处于哪个加载阶段都会渲染，
 * 保证首屏 HTML 里就有「模拟」字样 —— 这是冒烟检查的要求，
 * 也是「不冒充真实数据」原则的一部分。what 填页面主题，如「排期」「付款节点」。
 */
export function DataDisclosure({ what }: { what: string }) {
  return (
    <p className={`!mb-0 ${C.meta}`}>
      {what}中的模拟记录会单独标注，缺失信息显示为待确认。
    </p>
  );
}
