import type { Metadata } from "next";
import { RoleNavigation } from "@/components/RoleNavigation";
import "./globals.css";
import { SpaceHeader } from "@/components/ui/SpaceHeader";
export const metadata: Metadata = { title: "智装 AI 家装履约平台", description: "老房改造的需求澄清、报价比对与按节点验收" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><RoleNavigation /><main><SpaceHeader />{children}</main></body></html>;
}

