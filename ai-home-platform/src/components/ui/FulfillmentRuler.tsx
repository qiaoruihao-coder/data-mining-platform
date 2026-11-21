import React from "react";
import type { DemandStatus } from "@/contracts";

/**
 * 履约尺 + 验收章（D 维护的共享组件）。
 * 五个节点是真实的先后顺序；已走过的节点盖“已确认”章，当前节点用圆点标出。
 * 印泥红只在这里使用。盖章动画只在用户刚确认完成某个节点后播放（animateFrom），页面初次加载不播放。
 */
export const FULFILLMENT_STAGES: ReadonlyArray<{ status: DemandStatus; label: string }> = [
  { status: "draft", label: "需求澄清" },
  { status: "published", label: "匹配报价" },
  { status: "contracted", label: "签约定标" },
  { status: "in_progress", label: "施工中" },
  { status: "completed", label: "已完工" },
];

export function stageIndexOf(status: DemandStatus) {
  return Math.max(0, FULFILLMENT_STAGES.findIndex(stage => stage.status === status));
}

/** 已盖章（已完成）的节点数：已完工时五个节点全部完成。 */
export function completedStageCount(status: DemandStatus) {
  return status === "completed" ? FULFILLMENT_STAGES.length : stageIndexOf(status);
}

/**
 * 状态前进后需要新盖章的第一个节点下标；没有前进（首次读取、后退或不变）返回 null。
 * 用于只给“刚刚确认完成”的节点播放盖章动画。
 */
export function newlyStampedFrom(previous: DemandStatus | null | undefined, next: DemandStatus): number | null {
  if (!previous) return null;
  const before = completedStageCount(previous);
  return completedStageCount(next) > before ? before : null;
}

const trackStyle: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(90deg, #DDE3DF 0 1px, transparent 1px 10px), repeating-linear-gradient(90deg, #C5CEC9 0 1px, transparent 1px 50px)",
  backgroundSize: "100% 7px, 100% 14px",
  backgroundPosition: "bottom, bottom",
  backgroundRepeat: "no-repeat",
};

export function SealStamp({ label = "已确认", animate = false, delayMs = 0, className = "" }: {
  label?: string; animate?: boolean; delayMs?: number; className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={animate ? { animationDelay: `${delayMs}ms` } : undefined}
      className={`grid h-12 w-12 -rotate-12 place-items-center rounded-full border-[2.5px] border-seal font-song text-[13px] font-bold leading-none tracking-[0.06em] text-seal opacity-[0.88] shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_4.5px_#BF3A2B] sm:h-16 sm:w-16 sm:text-[15px] ${animate ? "seal-press" : ""} ${className}`}
    >
      {label}
    </span>
  );
}

export function FulfillmentRuler({ status, compact = false, animateStamps = false, animateFrom = null }: {
  status: DemandStatus; compact?: boolean;
  /** 所有章都播放盖章动画。 */
  animateStamps?: boolean;
  /** 只给下标不小于该值的章播放盖章动画（例如刚确认完成的节点）。 */
  animateFrom?: number | null;
}) {
  const current = stageIndexOf(status);
  const finished = status === "completed";
  const doneCount = completedStageCount(status);
  const summary = finished
    ? "履约进度：五个节点均已完成"
    : `履约进度：已完成 ${doneCount} 步，当前第 ${current + 1} 步${FULFILLMENT_STAGES[current].label}`;

  if (compact) {
    return (
      <div role="img" aria-label={summary}>
        <div className="grid grid-cols-5 gap-1">
          {FULFILLMENT_STAGES.map((stage, index) => (
            <span key={stage.status} className={`h-1 rounded-full ${index <= current || finished ? "bg-brand" : "bg-line"}`} />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-ink-3">
          <span>{FULFILLMENT_STAGES[0].label}</span>
          <span className="font-medium text-brand">{finished ? "已完工" : FULFILLMENT_STAGES[current].label}</span>
          <span>{FULFILLMENT_STAGES[FULFILLMENT_STAGES.length - 1].label}</span>
        </div>
      </div>
    );
  }

  const fill = finished ? 100 : current * 20;
  return (
    <div className="relative pt-[60px] sm:pt-[76px]">
      <p className="sr-only">{summary}</p>
      <div className="relative h-3.5 border-b-2 border-line-strong" style={trackStyle} aria-hidden="true">
        <div className="absolute -bottom-0.5 left-0 h-1 rounded-full bg-brand" style={{ width: `${fill}%` }} />
      </div>
      <ol className="m-0 mt-3 grid list-none grid-cols-5 p-0">
        {FULFILLMENT_STAGES.map((stage, index) => {
          const done = index < doneCount;
          const now = !finished && index === current;
          return (
            <li
              key={stage.status}
              aria-current={now ? "step" : undefined}
              className={`relative text-[13px] leading-snug sm:text-[15px] ${done ? "text-ink" : now ? "font-semibold text-brand" : "text-ink-3"}`}
            >
              {done && (
                <SealStamp
                  animate={animateStamps || (animateFrom !== null && index >= animateFrom)}
                  delayMs={(animateStamps ? index : Math.max(0, index - (animateFrom ?? 0))) * 180}
                  className="absolute -left-1 -top-[78px] sm:-top-[98px]"
                />
              )}
              {now && <span aria-hidden="true" className="absolute -top-[21px] left-0 h-3 w-3 rounded-full border-[3px] border-brand bg-white" />}
              <span className="num block text-[13px] font-normal">{index + 1}</span>
              {stage.label}
              <span className="sr-only">{done ? "（已完成）" : now ? "（进行中）" : "（未开始）"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
