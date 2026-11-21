"use client";

import type { OrderProgressEventDTO, SourceDTO } from "@/contracts";
import { Badge, Button, C, Card, Empty, Note, SectionHead } from "./ui";
import type { OrderProgressHistoryState } from "./order-progress-history";
import { useOrderProgressHistory } from "./useOrderProgressHistory";

function sourceLabel(source: SourceDTO): string {
  return source === "mock" ? "模拟数据" : "实际记录";
}

function actionLabel(event: OrderProgressEventDTO): string {
  if (event.action === "start") return "确认开工";
  if (event.action === "complete") return "确认完工";
  return event.action === "start_task" ? "开始工序" : "确认工序完成";
}

function statusLabel(status: OrderProgressEventDTO["fromStatus"] | OrderProgressEventDTO["toStatus"]): string {
  if (status === "contracted") return "已签约";
  if (status === "in_progress") return "施工中";
  return "已完工";
}

export function OrderProgressHistory({ demandId, revision }: { demandId: string; revision: number }) {
  const state = useOrderProgressHistory(demandId, revision);
  return <OrderProgressHistoryPanel state={state} onReload={state.reload} />;
}

export function OrderProgressHistoryPanel({
  state,
  onReload,
}: {
  state: OrderProgressHistoryState;
  onReload: () => void;
}) {
  if (state.phase === "loading") {
    return (
      <Card className="mt-4">
        <SectionHead title="履约记录" aside={<Badge tone="neutral">正在读取</Badge>} />
        <Note tone="info">正在读取履约记录。正在加载，模拟记录会单独标注。</Note>
      </Card>
    );
  }

  if (state.phase === "failed") {
    return (
      <Card className="mt-4">
        <SectionHead title="履约记录" aside={<Badge tone="danger">读取失败</Badge>} />
        <Note tone="danger" title="无法确认履约记录">
          <p>{state.error}</p>
          <Button variant="secondary" size="sm" onClick={onReload}>重新加载记录</Button>
        </Note>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <SectionHead title="履约记录" aside={<Badge tone={state.source === "mock" ? "accent" : "brand"}>查询来源：{sourceLabel(state.source)}</Badge>} />
      <p className={`!mb-3 ${C.meta}`}>以下为已保存的业主确认操作，不代表验收或付款。历史操作可能未全部收录，同一记录时间内的先后不代表实际操作顺序。</p>
      <Button variant="secondary" size="sm" onClick={onReload}>刷新记录</Button>
      {state.events.length === 0 ? (
        <Empty title="暂无履约记录" hint="完成施工操作后，记录会显示在这里。" />
      ) : (
        <ol className="mt-3 grid gap-2" aria-label="履约记录列表">
          {state.events.map(event => (
            <li key={event.id} className="break-words rounded-control border border-line bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[15px] font-medium text-ink">{actionLabel(event)}</span>
                <time className={C.meta} dateTime={event.createdAt}>记录时间：{event.createdAt.replace("T", " ")}</time>
              </div>
              <p className={`!mb-0 mt-1 ${C.meta}`}>{statusLabel(event.fromStatus)} 变为 {statusLabel(event.toStatus)}，来源：{sourceLabel(event.source)}</p>
              {event.taskId !== null ? <p className={`!mb-0 mt-1 ${C.meta}`}>工序编号：{event.taskId}</p> : null}
              {event.scheduleVersion !== null ? <p className={`!mb-0 mt-1 ${C.meta}`}>关联排期：v{event.scheduleVersion}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
