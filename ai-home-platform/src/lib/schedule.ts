import type { Schedule as PrismaSchedule } from "@prisma/client";
import { Schedule, type ScheduleDTO, type ScheduleQueryDTO, type SourceDTO } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { prisma } from "@/lib/prisma";

export type ScheduleDatabase = {
  schedule: Pick<typeof prisma.schedule, "findFirst" | "findUnique">;
};

export class ScheduleDataError extends Error {
  constructor() {
    super("排期数据格式无效。");
    this.name = "ScheduleDataError";
  }
}

export function scheduleSource(demandId: string): SourceDTO {
  return demandId === DEMO_DEMAND_ID ? "mock" : "live";
}

export function toScheduleDTO(row: Pick<PrismaSchedule, "demandId" | "version" | "tasksJson">): ScheduleDTO {
  let tasks: unknown;
  try {
    tasks = JSON.parse(row.tasksJson);
  } catch {
    throw new ScheduleDataError();
  }

  const parsed = Schedule.safeParse({ demandId: row.demandId, version: row.version, tasks });
  if (!parsed.success) throw new ScheduleDataError();
  return parsed.data;
}

export async function findSchedule(
  query: ScheduleQueryDTO,
  db: ScheduleDatabase = prisma,
): Promise<{ data: ScheduleDTO; source: SourceDTO } | null> {
  const row = query.version === undefined
    ? await db.schedule.findFirst({ where: { demandId: query.demandId }, orderBy: { version: "desc" } })
    : await db.schedule.findUnique({ where: { demandId_version: { demandId: query.demandId, version: query.version } } });
  if (!row) return null;
  return { data: toScheduleDTO(row), source: scheduleSource(row.demandId) };
}
