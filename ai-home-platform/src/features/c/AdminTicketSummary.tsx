import React from "react";
import { Ticket, type SourceDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";
import { C } from "@/components/ui";
import { summarizeTickets, ticketCategoryLabels, ticketStatusLabels, type TicketDTO } from "./admin-tickets";

export function AdminTicketSummary({ tickets, source }: {
  tickets: readonly TicketDTO[];
  source: SourceDTO;
}) {
  const summary = summarizeTickets(tickets);

  return (
    <section aria-labelledby="admin-ticket-summary-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-ticket-summary-title" className={`!mb-0 ${C.sectionTitle}`}>工单问题与状态概览</h2>
        <StatusBadge label={source === "mock" ? "概览来源：模拟标识（mock）" : "概览来源：已保存记录"} />
      </div>
      <p id="admin-ticket-summary-scope" className={`!mb-0 ${C.meta}`}>
        统计覆盖本次加载的全部工单，不随下方筛选改变；同一需求的多张工单分别计数，不代表平台全量数据。
      </p>
      <p className={`!mb-0 ${C.meta}`}>
        {source === "mock" ? "接口标记为 mock，以下数量仅供演示参考。" : "以下数量仅汇总接口返回的记录。"}
        工单分类与状态不代表客户满意度、责任认定或处理绩效。
      </p>
      <div role="region" aria-label="工单分类与状态统计，可横向滚动" tabIndex={0}
        className={`${C.cardFlush} overflow-x-auto`}>
        <table aria-describedby="admin-ticket-summary-scope" className="num w-full min-w-[360px] text-right text-[15px]">
          <caption className="px-4 pb-2 pt-4 text-left text-[16px] font-semibold text-ink">本次列表工单数量（单位：条）</caption>
          <thead className="border-y border-line bg-canvas text-[13px] text-ink-3">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">问题分类</th>
              {Ticket.shape.status.options.map(status => <th key={status} scope="col" className="px-3 py-2.5 font-medium">{ticketStatusLabels[status]}</th>)}
              <th scope="col" className="px-4 py-2.5 font-medium">小计</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Ticket.shape.category.options.map(category => (
              <tr key={category}>
                <th scope="row" className="px-4 py-3 text-left font-medium">{ticketCategoryLabels[category]}</th>
                {Ticket.shape.status.options.map(status => (
                  <td key={status} className="px-3 py-3 tabular-nums">{summary.byCategory[category][status]}</td>
                ))}
                <td className="px-4 py-3 font-medium tabular-nums">{Object.values(summary.byCategory[category]).reduce((sum, count) => sum + count, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-canvas font-semibold">
            <tr>
              <th scope="row" className="px-4 py-3 text-left">全部分类</th>
              {Ticket.shape.status.options.map(status => <td key={status} className="px-3 py-3 tabular-nums">{summary.byStatus[status]}</td>)}
              <td className="px-4 py-3 tabular-nums">{summary.total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
