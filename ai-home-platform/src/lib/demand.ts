import type { DemandOrder } from "@prisma/client";
import { Demand, type DemandDTO, type SourceDTO } from "@/contracts";
import { prisma } from "@/lib/prisma";
import { demoCompletedDemands } from "@/lib/mock-data";

export type DemandDatabase = {
  demandOrder: Pick<
    typeof prisma.demandOrder,
    "findMany" | "findUnique"
  >;
};

export const DEMO_DEMAND_ID = "demo-demand";
export const EDITABLE_DEMAND_STATUSES = ["draft", "published"] as const;
const mockDemandIds = new Set([DEMO_DEMAND_ID, ...demoCompletedDemands.map(demand => demand.id)]);

export function demandItemSource(id: string): SourceDTO {
  return mockDemandIds.has(id) ? "mock" : "live";
}

export function isEditableDemandStatus(status: string): status is (typeof EDITABLE_DEMAND_STATUSES)[number] {
  return EDITABLE_DEMAND_STATUSES.includes(status as (typeof EDITABLE_DEMAND_STATUSES)[number]);
}

/** 只把数据库字段映射为公共 Demand 契约，避免路由暴露 Prisma 记录。 */
export function toDemandDTO(row: Pick<
  DemandOrder,
  "id" | "description" | "city" | "areaM2" | "budgetMinCents" | "budgetMaxCents" | "renovationType" | "desiredDays" | "status"
>): DemandDTO {
  return Demand.parse({
    id: row.id,
    description: row.description,
    city: row.city,
    areaM2: row.areaM2,
    budgetMinCents: row.budgetMinCents,
    budgetMaxCents: row.budgetMaxCents,
    renovationType: row.renovationType,
    desiredDays: row.desiredDays,
    status: row.status,
    source: demandItemSource(row.id),
  });
}

export function demandSource(rows: Array<{ id: string }>): SourceDTO {
  // 列表响应只有一个 meta.source；混入演示需求时整体保持 mock，避免把 demo-demand 宣称为实时数据。
  return rows.length > 0 && rows.every((row) => demandItemSource(row.id) === "live") ? "live" : "mock";
}

export async function listDemands(db: DemandDatabase = prisma) {
  const rows = await db.demandOrder.findMany({ orderBy: { createdAt: "desc" } });
  return { data: rows.map(toDemandDTO), source: demandSource(rows) };
}

export async function findDemand(id: string, db: DemandDatabase = prisma) {
  const row = await db.demandOrder.findUnique({ where: { id } });
  if (!row) return null;
  return { data: toDemandDTO(row), source: demandSource([row]) };
}
