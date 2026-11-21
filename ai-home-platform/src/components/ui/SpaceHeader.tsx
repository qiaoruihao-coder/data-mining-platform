"use client";
import Image from "next/image";
import {usePathname} from "next/navigation";
export function SpaceHeader(){
 const path=usePathname();
 if(path==='/'||path.startsWith('/owner/matches/'))return null;
 const sections=path.startsWith('/owner/demand/chat')?['说说你的装修计划','房屋情况、预算与改造需求','space-15.jpg']:path.startsWith('/owner/quotes')?['核对费用与施工范围','报价核对 · 范围、材料与待确认项','space-10.jpg']:path.startsWith('/provider')?['找项目，跟进订单','服务方工作台 · 需求、报价与订单','space-11.jpg']:path.startsWith('/admin')?['查看项目与售后','平台运营 · 记录、反馈与协作','space-7.jpg']:path==='/mining'?['浏览相似的住宅案例','按面积、风格和预算分组','space-9.jpg']:path==='/demo'?['体验装修流程','模拟报价、排期与履约','space-16.jpg']:['跟进你的装修计划','我的装修 · 需求、进度与日常安排','space-8.jpg'];
 return <section className="space-header" aria-label="页面空间导览"><div><h2>{sections[0]}</h2><p>{sections[1]}</p></div><div className="space-header-image"><Image src={'/images/'+sections[2]} alt="自然光与原木家居的空间细节" fill sizes="(max-width: 640px) 100vw, 45vw" style={{objectFit:'cover',objectPosition:'center 55%'}}/></div></section>;
}
