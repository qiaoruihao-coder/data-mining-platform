"use client";

import "./globals.css";

/** 顶层布局本身出错时的兜底页（会替换整个页面，因此自带 html/body）。 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <main>
          <section aria-labelledby="global-error-title" role="alert" className="max-w-[38em] py-10 md:py-16">
            <p className="!mb-2 text-[15px] font-medium text-ink-3">智装 AI 家装履约平台</p>
            <h1 id="global-error-title" className="!mb-3">网站暂时没能打开</h1>
            <p className="text-[17px] text-ink-2">
              页面框架加载出错了。点“重新打开”会再试一次；如果反复出现，请把下面的错误编号发给维护者。
            </p>
            {error.digest ? <p className="text-[14px] text-ink-3">错误编号：<span className="num">{error.digest}</span></p> : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center rounded-control bg-brand px-5 py-2.5 text-[15px] font-medium leading-none text-white hover:bg-brand-hover"
              >
                重新打开
              </button>
              <a href="/" className="inline-flex items-center justify-center rounded-control border border-line bg-white px-5 py-2.5 text-[15px] font-medium leading-none text-ink no-underline hover:border-brand hover:text-brand">
                回到首页
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
