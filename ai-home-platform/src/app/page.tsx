import Link from "next/link";
import Image from "next/image";
import { CaseCount } from "@/components/ui/CaseUpdate";

export default function Home() {
 return <div className="editorial-home">
  <section className="home-cover">
   <div className="home-cover-copy"><h1>装修有参考，<br/><em>改造有计划。</em></h1><p>按面积、预算和风格，找装修参考。</p><div className="editorial-actions"><Link className="editorial-button" href="/owner/matches/demo-demand">浏览装修案例 <span aria-hidden="true">↗</span></Link><Link className="editorial-text-link" href="/owner/demand/chat">填写改造需求</Link></div><div className="home-source-note"><CaseCount/> 个国内公开住宅案例 · 可查看原始出处<br/></div></div>
   <figure className="home-cover-visual"><Image src="/images/home-editorial.jpg" alt="原木柜体、纸灯与休闲椅组成的温暖住宅空间" width={1080} height={1440} priority sizes="(max-width: 760px) 100vw, 55vw"/></figure>
  </section>
  <section className="editorial-intro"><h2>先看案例，<br/>再定方案。</h2><div><p>看看面积相近的住宅，比较风格、布局和造价。</p><p className="editorial-muted">造价仅供参考，服务范围需另行确认。</p></div></section>
  <section className="home-paths"><Link href="/owner/matches/demo-demand"><h3>找到相似的家</h3><p>按面积、预算与改造需求，查看案例推荐。</p><span>浏览公开案例 ↗</span></Link><Link href="/mining"><h3>看懂空间的共性</h3><p>按面积、预算和风格查看案例分组。</p><span>探索案例群体 ↗</span></Link><Link href="/owner"><h3>我的装修计划</h3><p>管理需求与施工进度。</p><span>进入我的装修 ↗</span></Link></section>
  <section className="home-story"><figure><Image src="/images/home-detail.jpg" alt="自然光下的原木客厅与收纳细节" width={1080} height={1440} sizes="(max-width: 760px) 100vw, 45vw"/></figure><div><h2>从需求到施工，<br/>随时查看进展。</h2><p>管理需求、报价和施工进度。</p><Link className="editorial-text-link" href="/demo">了解履约演示 ↗</Link></div></section>
  <footer className="editorial-footer"><span>智装 · 装修计划与进度</span><Link href="/demo">模拟履约说明</Link></footer>
 </div>;
}
