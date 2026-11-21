"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import initial from "@/contracts/domestic-recommendation.json";
import {CaseUpdate,useCases} from "@/components/ui/CaseUpdate";
import type { DemandDTO } from "@/contracts";

type Case = typeof initial.cases[number];
const styleWords: Record<string,string[]> = { elderly:["适老","无障碍","老人"], partial:["局部","改造","翻新"], repair:["维修","修复","改造"] };
function score(c:Case,d:DemandDTO){
 const area=Math.exp(-Math.abs(Math.log(Math.max(1,c.area)/Math.max(1,d.areaM2))));
 const total=c.costYuan===null?0.45:Math.exp(-Math.abs(Math.log(Math.max(1,c.costYuan)/Math.max(1,d.budgetMaxCents/100))));
 const words=[d.description.toLowerCase(),...(styleWords[d.renovationType]||[])];
 const text=(c.title+' '+c.style+' '+c.space).toLowerCase();
 const fit=words.some(w=>text.includes(w.toLowerCase()))?1:.35;
 return Math.round((.42*area+.33*total+.25*fit)*100);
}
export function DomesticCaseRecommendations({demand}:{demand:DemandDTO}){
 const {data:domestic,error}=useCases();
 const [cluster,setCluster]=React.useState<number|undefined>();
 const groups=[...new Set(domestic.cases.map(c=>c.cluster))].sort((a,b)=>a-b);
 const rows=domestic.cases.filter(c=>cluster===undefined||c.cluster===cluster).map(c=>({...c,score:score(c,demand)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,6);
 const budget=`¥${(demand.budgetMinCents/100).toLocaleString('zh-CN')}–¥${(demand.budgetMaxCents/100).toLocaleString('zh-CN')}`;
 return <section className="case-discovery" aria-labelledby="domestic-case-recommendations"><div className="case-cover"><div><h1 id="domestic-case-recommendations">装修案例<br/><em>推荐</em></h1><p>从 {domestic.cases.length} 个国内公开案例中，筛选相似住宅。</p><p className="case-demand">{demand.city} · {demand.areaM2}㎡ · 预算 {budget}</p><Link href="/owner/demand/chat" className="editorial-text-link">描述我的改造需求 ↗</Link>{demand.id==='demo-demand'&&<p className="editorial-muted mt-3">当前为示例需求，可创建自己的需求。</p>}</div><figure><Image src="/images/space-9.jpg" alt="原木色客厅空间灵感" width={1080} height={1440} sizes="(max-width: 760px) 100vw, 35vw"/></figure></div><CaseUpdate/>{error&&<p role="alert">{error}</p>}<div className="case-filter" aria-label="案例聚类筛选"><span>案例分组</span><button type="button" aria-pressed={cluster===undefined} onClick={()=>setCluster(undefined)}>全部案例</button>{groups.map(id=><button type="button" key={id} aria-pressed={cluster===id} onClick={()=>setCluster(id)}>群体 {id}</button>)}<Link href="/mining">查看聚类 ↗</Link></div><div className="case-list" aria-live="polite">{rows.map(c=><article key={c.id} className="case-row"><div className="case-score"><strong>{c.score}</strong><span>相似度分 / 100</span></div><div className="case-row-main"><p className="case-tags">{c.style} / {c.space} / 群体 {c.cluster}</p><h2><a href={c.url} target="_blank" rel="noreferrer">{c.title}</a></h2><p>{c.area}㎡ <span className="mx-2">·</span>{c.costYuan===null?'参考造价未公开':`参考造价 ¥${c.costYuan.toLocaleString('zh-CN')}`}</p><p className="editorial-muted">设计方：{c.providerName}{c.providerLocation?` · ${c.providerLocation}`:''}</p></div><a className="case-source" href={c.url} target="_blank" rel="noreferrer">查看案例 <span aria-hidden="true">↗</span></a></article>)}</div><details className="case-explanation"><summary>推荐说明</summary><p>推荐权重：面积42%、造价33%、需求25%。缺失造价用中性分；分数不代表质量或成交概率。</p><p>来源：设计本。造价仅供参考，设计方未入驻本平台。分组表示案例相似性，不是等级。</p></details></section>;
}
