import type { Metadata } from "next";
import { RoleNavigation } from "@/components/RoleNavigation";
import "./globals.css";
import { SpaceHeader } from "@/components/ui/SpaceHeader";
import {ExperienceAccess} from '@/components/ui/ExperienceAccess';
import {PublicAccountAccess} from '@/components/ui/PublicAccountAccess';
export const dynamic='force-dynamic';
export const metadata: Metadata = { title: "智装 AI 家装履约平台", description: "老房改造的需求澄清、报价比对与按节点验收" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const demo=process.env.ISOLATED_DEMO==='true';
  const candidate=demo?process.env.NORMAL_APP_URL:process.env.DEMO_APP_URL;
  let otherUrl='';try{if(candidate&&new URL(candidate).protocol==='https:')otherUrl=candidate;}catch{}
  const content=<><RoleNavigation /><main><SpaceHeader />{children}</main></>;
  const publicAccess=process.env.PUBLIC_ACCOUNT_ACCESS==='true'&&!demo;
  return <html lang="zh-CN"><body>{publicAccess?<PublicAccountAccess>{content}</PublicAccountAccess>:<><ExperienceAccess demo={demo} otherUrl={otherUrl}/>{content}</>}</body></html>;
}

