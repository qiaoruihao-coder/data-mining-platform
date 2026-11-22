'use client';
import {useState} from 'react';
export function ExperienceAccess({demo,otherUrl}:{demo:boolean;otherUrl:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function enter(role:'owner'|'provider'|'admin'){
  setBusy(true);setError('');
  try{const r=await fetch('/api/auth/experience',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})});const b=await r.json();if(!r.ok||!b.ok)throw new Error(b.error?.message??'登录失败');window.location.assign(role==='owner'?'/owner':role==='provider'?'/provider':'/admin');}
  catch(e){setError(e instanceof Error?e.message:'登录失败');setBusy(false);}
 }
 return <section className="mx-auto max-w-7xl px-6 py-3 text-sm" aria-label="登录模式">
  <strong>{demo?'演示体验 · 独立模拟数据':'正常账号入口'}</strong>
  <p>{demo?'此站所有身份与业务记录仅供演示，不代表真实交易。角色切换会退出上一演示身份。':'请从右上角登录原有业主、服务方或平台运营账号。首次访问新地址需重新登录。'}</p>
  {demo&&<div className="my-2 flex flex-wrap gap-3">{(['owner','provider','admin'] as const).map((role,i)=><button key={role} disabled={busy} onClick={()=>enter(role)} className="rounded border border-line bg-white px-4 py-2">{busy?'处理中…':['以业主演示','以服务方演示','以平台运营演示'][i]}</button>)}</div>}
  {otherUrl&&<a className="underline" href={otherUrl}>{demo?'使用原账号登录 ↗':'无需密码，体验三个演示角色 ↗'}</a>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
