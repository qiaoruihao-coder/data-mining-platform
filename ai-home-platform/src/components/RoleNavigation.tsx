"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { AccountMenu } from "@/components/ui/AccountMenu";

const roles = {
  owner: {
    label: "业主",
    links: [
      ["我的装修", "/owner"],
      ["需求澄清", "/owner/demand/chat"],
      ["案例推荐", "/owner/matches/demo-demand"],
      ["案例聚类", "/mining"],
      ["履约演示", "/demo"],
    ],
  },
  provider: {
    label: "服务方",
    links: [
      ["需求大厅", "/provider"],
      ["我的订单", "/provider/orders"],
    ],
  },
  operator: {
    label: "平台运营",
    links: [
      ["运营看板", "/admin"],
      ["售后工单", "/admin/tickets"],
    ],
  },
} as const;

type Role = keyof typeof roles;

function roleForPath(pathname: string): Role {
  if (pathname === "/provider" || pathname.startsWith("/provider/")) return "provider";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "operator";
  return "owner";
}

export function RoleNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const role = roleForPath(pathname);

  const current = roles[role];
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto max-w-[1080px] px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-4">
          <Link href="/" className="flex items-baseline gap-2 text-ink no-underline hover:no-underline">
            <strong className="text-[20px] tracking-[0.02em]">智装有约</strong>
            <span className="text-[13px] text-ink-3">住宅灵感与改造</span>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {pending && <span role="status" className="text-[13px] text-ink-3">正在切换页面…</span>}
            <div role="group" aria-label="身份切换" className="inline-flex rounded-control border border-line bg-canvas p-[3px]">
              {Object.entries(roles).map(([value, item]) => {
                const active = value === role;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    disabled={pending}
                    onClick={() => {
                      if (active) return;
                      startTransition(() => router.push(roles[value as Role].links[0][1]));
                    }}
                    className={`rounded-[6px] px-3.5 py-1.5 text-[14px] font-medium disabled:cursor-wait ${active ? "bg-white text-brand shadow-[0_1px_2px_rgba(29,43,41,0.12)]" : "text-ink-2 hover:text-ink"}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <AccountMenu />
          </div>
        </div>
        <nav className="-mb-px mt-2 flex gap-7 overflow-x-auto" aria-label="产品导航">
          {current.links.map(([label, href]) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-[15px] no-underline hover:no-underline ${active ? "border-brand font-semibold text-brand" : "border-transparent text-ink-2 hover:text-brand"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

