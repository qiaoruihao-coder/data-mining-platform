"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, C } from "@/components/ui";
import { MatchResults } from "@/features/b/MatchResults";
import { loadMatches, matchLoadErrorMessage, MatchDemandNotFound } from "@/features/b/load-matches";
import { Source, type ProviderDTO } from "@/contracts";
import { DomesticCaseRecommendations } from "@/features/b/DomesticCaseRecommendations";

type MatchPageState =
  | { status: "loading" }
  | { status: "ready"; data: Awaited<ReturnType<typeof loadMatches>> }
  | { status: "not-found" }
  | { status: "error"; message: string };

export function MatchPageContent({ state, retry }: { state: MatchPageState; retry: () => void }) {
  if (state.status === "ready") return <>
    <DomesticCaseRecommendations demand={state.data.demand} />
    <details id="fulfillment-demo" className="fulfillment-demo"><summary>履约演示 · 查看模拟施工队匹配</summary><p>以下服务方基础资料为模拟数据，与上方公开案例设计方没有对应关系。</p><MatchResults data={state.data} actions={<Button variant="secondary" onClick={retry}>刷新匹配</Button>} /></details>
  </>;
  return (
    <section className={C.card} aria-busy={state.status === "loading"}>
      <Badge tone="accent">服务方接口当前提供模拟资料</Badge>
      <h1 className="mt-4">{state.status === "not-found" ? "需求未找到" : state.status === "error" ? "暂时无法展示匹配结果" : "正在读取需求和服务方资料"}</h1>
      {state.status === "loading" && <p role="status">加载完成后将分别标明需求与服务方来源，不会用演示需求替代这份需求。</p>}
      {state.status === "not-found" && <p role="status">这份需求不存在，请返回需求列表选择已有需求。</p>}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <Button disabled={state.status === "loading"} onClick={retry}>{state.status === "loading" ? "加载中…" : "重新加载"}</Button>
        <Link className="text-[15px] font-medium" href="/owner">返回需求列表</Link>
      </div>
    </section>
  );
}

export function MatchPage({ demandId }: { demandId: string }) {
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  const [selectedSource, setSelectedSource] = React.useState<NonNullable<ProviderDTO["source"]>>("live");
  const performanceSource = demandId === "demo-demand" ? selectedSource : "live";
  const [result, setResult] = React.useState<{ id: string; attempt: number; performanceSource: typeof performanceSource; state: MatchPageState } | null>(null);

  React.useEffect(() => {
    let active = true;
    void loadMatches(demandId, performanceSource).then(
      (data) => { if (active) setResult({ id: demandId, attempt, performanceSource, state: { status: "ready", data } }); },
      (error: unknown) => {
        if (active) setResult({ id: demandId, attempt, performanceSource, state: error instanceof MatchDemandNotFound
          ? { status: "not-found" }
          : { status: "error", message: matchLoadErrorMessage(error) } });
      },
    );
    return () => { active = false; };
  }, [demandId, attempt, performanceSource]);

  // 路由、口径或重试变化时立即隐藏旧结果；迟到的请求不能覆盖当前选择。
  const state: MatchPageState = result?.id === demandId && result.attempt === attempt && result.performanceSource === performanceSource ? result.state : { status: "loading" };
  // 演示口径切换固定在页面顶部，切换后加载状态变化时不重新挂载，保持键盘焦点。
  return <div className="space-y-5">
    <MatchPageContent state={state} retry={retry} />
    {demandId === "demo-demand" && <details className="demo-source-control" aria-label="固定演示评价口径"><summary>模拟履约的评价统计设置</summary>
      <div className="min-w-0">
      <label className="block text-[14px] font-medium text-ink-2" htmlFor="match-performance-source">评价统计来源（固定演示页）</label>
      <select id="match-performance-source" className={`${C.input} mt-1.5 sm:w-auto`} value={selectedSource} onChange={event => setSelectedSource(Source.parse(event.target.value))}>
        <option value="live">live · 已保存的非模拟接单评价</option>
        <option value="mock">模拟评价（演示）</option>
      </select>
      </div>
      <p className={`!mb-0 min-w-0 flex-1 basis-64 ${C.meta}`}>选择 mock 会读取模拟接单评价，仅用于演示；不代表真实口碑。不会用模拟评价补齐 live 的无样本结果，切换后重新读取。</p>
    </details>}

  </div>;
}


