import Link from "next/link";

export default function NotFound() {
  return <section className="card"><span className="badge">演示需求未找到</span><h1>无法展示这份需求的报价</h1><p>当前演示数据中没有这个需求 ID。请返回需求列表，选择已有需求后再查看报价。</p><Link className="text-[15px] font-medium" href="/owner">返回需求列表</Link></section>;
}
