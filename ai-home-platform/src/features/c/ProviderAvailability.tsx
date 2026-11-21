"use client";

import React, { useEffect, useState } from "react";
import type { ProviderDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";
import { C } from "@/components/ui";
import { providerAvailabilityStatus } from "./provider-availability";

export function ProviderAvailabilityContent({ availability, now }: {
  availability: ProviderDTO["availability"];
  now: number | null;
}) {
  const status = providerAvailabilityStatus(availability, now);
  return (
    <section aria-labelledby="provider-availability-title" className="mt-6 space-y-4 border-t border-line pt-6">
      <h3 id="provider-availability-title" className={`!mb-1 ${C.sectionTitle}`}>服务方档期</h3>
      <p className={`!mb-0 ${C.meta}`}>档期仅供资料核对，不代表预约、锁定或施工承诺；仍需与服务方确认。</p>
      {availability == null ? (
        <p role="status">档期未知：本次资料未提供档期及其来源，不能据此认定没有可用窗口。</p>
      ) : (
        <>
          <StatusBadge label={availability.source === "mock" ? "档期来源：模拟标识（mock）" : "档期来源：已保存记录"} />
          <p className={C.pageSub}>{availability.source === "mock"
            ? "档期为模拟样例，仅供演示，不代表真实服务方产能。"
            : "档期由实时接口返回，来源标识不代表服务方已确认接单。"}</p>
          <dl className="num m-0 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2">
              <dt className={C.meta}>查询覆盖日期（Asia/Shanghai 自然日，含首尾日）</dt>
              <dd className="m-0 mt-1 flex flex-wrap gap-x-2"><time dateTime={availability.coverageStartDate}>{availability.coverageStartDate}</time><span>至</span><time dateTime={availability.coverageEndDate}>{availability.coverageEndDate}</time></dd>
            </div>
            <div className="min-w-0"><dt className={C.meta}>档期更新时间（含时区）</dt><dd className="m-0 mt-1 break-all"><time dateTime={availability.updatedAt}>{availability.updatedAt}</time></dd></div>
            <div className="min-w-0"><dt className={C.meta}>有效截止（含时区）</dt><dd className="m-0 mt-1 break-all"><time dateTime={availability.validUntil}>{availability.validUntil}</time></dd></div>
          </dl>
          <div role="status" aria-live="polite">
            {status === "checking" && <p>正在核对档期有效期…</p>}
            {status === "expired" && <p className={`${C.note} ${C.noteWarn}`}>档期待更新：已达到有效截止，旧窗口不再作为当前档期展示。可刷新资料核对更新。</p>}
            {status === "empty" && <p>本次覆盖区间内没有已确认窗口；不代表其他日期没有档期。</p>}
            {status === "recorded" && (
              <div>
                <p>已记录档期窗口（含首尾日）</p>
                <ul aria-label="已记录档期窗口" className="space-y-2">
                  {availability.windows.map(window => (
                    <li key={window.startDate} className="num flex flex-wrap gap-x-2 rounded-control bg-canvas px-3 py-2">
                      <time dateTime={window.startDate}>{window.startDate}</time><span>至</span><time dateTime={window.endDate}>{window.endDate}</time>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className={`${C.pageSub} !mb-0`}>有效期按当前设备时间核对；页面会定期复核，切回页面时也会复核。刷新资料可重新查询接口。</p>
        </>
      )}
    </section>
  );
}

export function ProviderAvailability({ availability }: { availability: ProviderDTO["availability"] }) {
  // Start without a clock on both SSR and the first client render to avoid hydration differences.
  const [now, setNow] = useState<number | null>(null);
  const validUntil = availability?.validUntil;
  useEffect(() => {
    if (!validUntil) return;
    const deadline = Date.parse(validUntil);
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const remaining = deadline - current;
      // Recheck at the cutoff, periodically for clock changes, and when returning to the tab.
      timer = setTimeout(update, remaining > 0 ? Math.min(60_000, remaining) : 60_000);
    }
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [validUntil]);
  return <ProviderAvailabilityContent availability={availability} now={now} />;
}
