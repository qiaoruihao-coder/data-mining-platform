import type { GanttRow } from "@/features/a/schedule";

/**
 * 甘特图（纯展示组件）：只接收算好的行数据，不引业务逻辑、不发请求。
 * 这样 C 的施工方端以后也能直接复用，不用跟着 A 的 features 目录走。
 *
 * 时间轴按「天」等分，用百分比定位，所以总工期变化时不需要改任何类名；
 * 工序多的时候横向滚动，不压缩条形宽度。
 */

const BAR: Record<GanttRow["status"], string> = {
  done: "border-brand/30 bg-brand-soft text-brand-hover",
  active: "border-brand bg-brand text-white",
  pending: "border-line bg-mist text-ink-2",
  blocked: "border-danger/25 bg-danger-soft text-danger",
};

const DOT: Record<GanttRow["status"], string> = {
  done: "bg-brand",
  active: "bg-brand ring-2 ring-brand/[0.12]",
  pending: "bg-line-strong",
  blocked: "bg-danger",
};

const LEGEND: { status: GanttRow["status"]; label: string }[] = [
  { status: "done", label: "已完成" },
  { status: "active", label: "进行中" },
  { status: "pending", label: "待开工" },
  { status: "blocked", label: "受阻" },
];

export function GanttChart({
  rows,
  totalDays,
  currentDay,
}: {
  rows: GanttRow[];
  totalDays: number;
  /** 推算的「今天」是第几天（0 起），不传则不画参考线 */
  currentDay?: number | null;
}) {
  if (rows.length === 0 || totalDays <= 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-canvas/50 px-4 py-8 text-center text-[14px] text-ink-3">
        没有可展示的工序，接口返回的排期为空。
      </div>
    );
  }

  const dayPercent = 100 / totalDays;
  const tickStep = totalDays <= 15 ? 1 : totalDays <= 31 ? 2 : Math.ceil(totalDays / 15);
  const ticks = Array.from({ length: totalDays }, (_, index) => index).filter(
    (index) => index % tickStep === 0,
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* 天数刻度 */}
          <div className="flex items-end gap-3">
            <div className="w-[168px] shrink-0 pb-1 text-[13px] font-medium text-ink-3">
              工序（共 {totalDays} 天）
            </div>
            <div className="relative h-5 flex-1">
              {ticks.map((day) => (
                <span
                  key={day}
                  className="absolute top-0 -translate-x-1/2 text-[13px] tabular-nums text-ink-3"
                  style={{ left: `${day * dayPercent + dayPercent / 2}%` }}
                >
                  {day + 1}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-1.5 grid gap-1.5">
            {rows.map((row) => (
              <div key={row.id} className="flex items-stretch gap-3">
                <div className="flex w-[168px] shrink-0 items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[row.status]}`} />
                  <div className="min-w-0">
                    <div
                      className="truncate text-[14px] font-medium text-ink"
                      title={row.name}
                    >
                      {row.name}
                    </div>
                    <div className="truncate text-[13px] text-ink-3" title={row.rangeLabel}>
                      {row.rangeLabel}
                    </div>
                  </div>
                </div>

                <div className="relative h-11 flex-1 rounded-tag bg-canvas/50">
                  {/* 每天一条竖向网格线 */}
                  <div
                    className="absolute inset-0 rounded-tag"
                    style={{
                      backgroundImage:
                        "linear-gradient(to right, #EDF0EE 0 1px, transparent 1px)",
                      backgroundSize: `${dayPercent}% 100%`,
                    }}
                  />
                  {typeof currentDay === "number" ? (
                    <div
                      className="absolute inset-y-0 w-px bg-wood/45"
                      style={{
                        left: `${Math.min(Math.max(currentDay, 0), totalDays) * dayPercent}%`,
                      }}
                    />
                  ) : null}
                  <div
                    className={`absolute inset-y-[6px] overflow-hidden rounded-[4px] border px-2 text-[13px] font-medium leading-[26px] ${BAR[row.status]}`}
                    style={{
                      left: `${row.startDay * dayPercent}%`,
                      width: `${row.durationDays * dayPercent}%`,
                      minWidth: 22,
                    }}
                    title={`${row.name}：${row.rangeLabel}，${row.statusLabel}${
                      row.deps.length ? `，前置：${row.deps.join("、")}` : ""
                    }`}
                  >
                    <span className="block truncate">{row.statusLabel}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[13px] text-ink-3">
        {LEGEND.map((item) => (
          <span key={item.status} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-[2px] ${DOT[item.status]}`} />
            {item.label}
          </span>
        ))}
        {typeof currentDay === "number" ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-px bg-wood/60" />
            当前工序起点（按任务状态推算，非真实日期）
          </span>
        ) : null}
      </div>
    </div>
  );
}
