import * as React from "react";
import type { ProviderDTO } from "@/contracts";
import { assessAvailability } from "@/lib/match/availability";

export function AvailabilitySummary({ availability, desiredDays, readAt }: {
  availability: ProviderDTO["availability"]; desiredDays: number; readAt: number;
}) {
  const result = assessAvailability(availability, desiredDays, readAt);
  const labels = {
    unknown: "档期未知，不按无窗口处理。",
    expired: "档期待更新，不参与档期排序。",
    empty: "覆盖范围内没有剩余可用窗口，不代表其他日期无档期。",
    insufficient: `单段剩余窗口不足 ${desiredDays} 天，不拼接多段窗口。`,
    fits: `有单段剩余窗口可容纳 ${desiredDays} 天，仍需服务方确认。`,
  };
  return <section className="mb-4 rounded-control bg-canvas p-4 text-[14px] text-ink-2" aria-label="读取时的档期参考">
    <h4 className="mb-2 text-[14px] font-semibold text-ink">读取时的档期参考（上海自然日）</h4>
    <p className={result.status === "fits" ? "font-medium text-brand-hover" : result.status === "insufficient" || result.status === "empty" ? "font-medium text-warn" : undefined}>{labels[result.status]}</p>
    {result.data ? <>
      <p>档期来源：{result.data.source === "mock" ? "mock · 固定模拟窗口" : "live · 接口档期资料"}</p>
      <p>覆盖范围：{result.data.coverageStartDate} 至 {result.data.coverageEndDate}</p>
      {result.data.windows.length > 0 && <ul aria-label="原始档期窗口">{result.data.windows.map(window => <li key={window.startDate}>{window.startDate} 至 {window.endDate}</li>)}</ul>}
      {result.remaining.length > 0 && <ul className="num" aria-label="读取时剩余窗口">{result.remaining.map(window => <li key={window.startDate}>剩余 {window.startDate} 至 {window.endDate}：{window.days} 天</li>)}</ul>}
      <p className="break-all text-[13px]">更新时间：<time dateTime={result.data.updatedAt}>{result.data.updatedAt}</time></p>
      <p className="break-all text-[13px]">有效截止：<time dateTime={result.data.validUntil}>{result.data.validUntil}</time>（到点失效）</p>
      {result.status === "unknown" && <p>读取时钟或工期无法核对，请刷新并核对设备时间。</p>}
    </> : <p>档期数据或来源未提供或不符合约定。</p>}
    <p className="mb-0 text-[13px] text-ink-3">仅反映本次读取时点，点击“刷新匹配”重新核对；不是预约、产能锁定或实际工期承诺。</p>
  </section>;
}
