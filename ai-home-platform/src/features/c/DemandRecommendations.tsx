"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ProviderRecommendations, type ProviderRecommendationsDTO, type SourceDTO } from '@/contracts';
import { apiGet } from '@/lib/api-client';
import { Button, C } from '@/components/ui';

export function DemandRecommendations() {
  const [scope,setScope]=useState<'profile'|'selected'|'all'>('all');
  const [cities,setCities]=useState('');
  const [appliedCities,setAppliedCities]=useState('');
  const [source,setSource] = useState<SourceDTO>('live');
  const [version,setVersion] = useState(0);
  const [group,setGroup] = useState<number|null>(null);
  const [state,setState] = useState<{data?:ProviderRecommendationsDTO;error?:string;loading:boolean}>({loading:true});
  useEffect(()=>{
    let active=true;
    setState({loading:true}); setGroup(null);
    apiGet(`/api/provider/recommendations?historySource=${source}&scope=${scope}${scope==='selected'?`&cities=${encodeURIComponent(appliedCities)}`:''}`,ProviderRecommendations).then(
      result=>{if(active)setState({loading:false,data:result.data});},
      error=>{if(active)setState({loading:false,error:error instanceof Error?error.message:'推荐读取失败'});},
    );
    return ()=>{active=false;};
  },[source,version,scope,appliedCities]);
  const data=state.data;
  const items=data?.items.filter(item=>group===null||item.clusterId===group)??[];
  return <section className="mb-10 border-b border-line pb-8" aria-labelledby="demand-recommendation-title">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 id="demand-recommendation-title">为我推荐（聚类）</h2><p className="text-ink-2">根据过往订单推荐新需求。</p></div>
      <Button variant="secondary" disabled={state.loading} onClick={()=>setVersion(v=>v+1)}>{state.loading?'计算中…':'刷新推荐'}</Button>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label htmlFor="recommendation-source">历史依据</label>
      <select id="recommendation-source" className={C.input} value={source} onChange={e=>setSource(e.target.value==='mock'?'mock':'live')}>
        <option value="live">真实历史</option><option value="mock">模拟成交历史</option>
      </select>
      <Link href="/provider/orders" className="underline">查看我的成交记录</Link>
    </div>
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label>推荐范围<select className={C.input} value={scope} onChange={e=>{const v=e.target.value as typeof scope;if(v==='selected'&&!appliedCities){setAppliedCities(data?.providerCity||'上海');setCities(data?.providerCity||'上海');}setScope(v);}}><option value="all">全部城市</option><option value="profile">资料所在城市</option><option value="selected">指定服务城市</option></select></label>
      {scope==='selected'&&<form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setAppliedCities(cities.trim());}}><label>服务城市<input className={C.input} value={cities} onChange={e=>setCities(e.target.value)} placeholder="上海，杭州，苏州" required maxLength={300}/></label><Button type="submit">应用</Button></form>}
    </div>
    {source==='mock'&&<p className="text-ink-2">使用模拟订单演示，不涉及真实施工或付款。</p>}
    {state.loading&&<p role="status">正在计算推荐…</p>}
    {state.error&&<p role="alert">{state.error} 请确认服务方已登录后重试。</p>}
    {data&&<>
      <p role="status">资料城市：{data.providerCity} · 已完成{source==='mock'?'模拟':''}订单 {data.historyCount} 份 · {data.mode==='cold_start'?'暂无历史，按城市和专长推荐':'按已完成订单推荐'}。当前范围 {data.items.length} 条待接需求。</p>
      <p className={C.meta}>按所选范围展示推荐，跨城项目需确认服务范围。</p>
      <div className="mb-5 flex flex-wrap gap-2" aria-label="推荐需求群体">
        <button className={`${C.btnBase} ${C.btnSecondary} ${C.btnSm}`} aria-pressed={group===null} onClick={()=>setGroup(null)}>全部推荐</button>
        {data.clusters.map(c=><button key={c.id} className={`${C.btnBase} ${C.btnSecondary} ${C.btnSm}`} aria-pressed={group===c.id} onClick={()=>setGroup(c.id)}>群体 {c.id+1} · {c.label} · 历史 {c.historyCount} / 待接 {c.publishedCount}</button>)}
      </div>
      {items.length===0?<p className={C.note}>当前范围暂无需求，可切换城市或群体。</p>:<ul className="m-0 list-none divide-y divide-line p-0">
        {items.map(({demand,score,clusterId,reasons})=><li key={demand.id} className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="!mb-0">{demand.city} · {demand.areaM2}㎡ · 群体 {clusterId+1}</h3><span className="font-semibold text-brand">推荐分 {score} / 100</span></div>
          <p className="mt-3 break-words">{demand.description}</p>
          <p>预算 ¥{(demand.budgetMinCents/100).toLocaleString('zh-CN')}–{(demand.budgetMaxCents/100).toLocaleString('zh-CN')} · 期望 {demand.desiredDays} 天</p>
          <ul className="mb-4 text-sm text-ink-2">{reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
          <Link href={`/provider/demand/${encodeURIComponent(demand.id)}`} className={`${C.btnBase} ${C.btnSecondary} ${C.btnSm}`}>查看需求并报价</Link>
        </li>)}
      </ul>}
      <details className="mt-5 text-sm text-ink-2"><summary className="cursor-pointer py-3">聚类与推荐如何计算</summary>
        <p>对面积、预算中点与期望工期取对数并标准化，结合改造类型和施工关键词进行 K-means 聚类，最多 3 个群体。群体名称根据结果中占比最高的改造类型概括。</p>
        <p>有历史时：相似历史订单得分 75%＋历史群体占比 20%＋专长匹配 5%；无历史时按专长排序，城市范围由您选择。推荐分不是成交概率、质量评级或档期承诺。模拟样本仅验证业务流程，不证明真实推荐效果。</p>
      </details>
    </>}
  </section>;
}
