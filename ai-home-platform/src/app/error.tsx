"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";

/** 页面渲染出错时的兜底页：说明发生了什么、怎么恢复；不展示内部错误详情。 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section aria-labelledby="error-title" role="alert" className="max-w-[38em] py-10 md:py-16">
      <h1 id="error-title" className="!mb-3">这一页没能显示出来</h1>
      <p className="text-[17px] text-ink-2">
        页面加载失败，请刷新后重试。刷新不会重新提交表单。
      </p>
      {error.digest ? <p className="text-[14px] text-ink-3">错误编号：<span className="num">{error.digest}</span></p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>重试</Button>
        <Button variant="secondary" onClick={()=>window.location.reload()}>刷新页面</Button>
        <LinkButton href="/" variant="secondary">回到首页</LinkButton>
      </div>
    </section>
  );
}
