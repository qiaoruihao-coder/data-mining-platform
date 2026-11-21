import type { DemandDTO } from "@/contracts";
export function DemandCard({demand}:{demand:DemandDTO}) {
 return <section className="card"><h2>{demand.city} {demand.areaM2}㎡改造</h2><p>{demand.description}</p><p className="num">预算 ¥{(demand.budgetMinCents/100).toLocaleString()}–¥{(demand.budgetMaxCents/100).toLocaleString()}，期望 {demand.desiredDays} 天</p></section>;
}
