import { LinkButton } from "@/components/ui";

export const metadata = { title: "没有找到这个页面 | 智装" };

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title" className="max-w-[38em] py-10 md:py-16">
      <p className="!mb-2 text-[15px] font-medium text-ink-3">404</p>
      <h1 id="not-found-title" className="!mb-3">没有找到这个页面</h1>
      <p className="text-[17px] text-ink-2">
        地址可能输错了，或者这条需求、报价已经不存在。可以从首页或“我的装修”重新进入。
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <LinkButton href="/">回到首页</LinkButton>
        <LinkButton href="/owner" variant="secondary">打开我的装修</LinkButton>
      </div>
    </section>
  );
}
