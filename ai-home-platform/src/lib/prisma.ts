import { PrismaClient } from "@prisma/client";
const dbGlobal = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = dbGlobal.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") dbGlobal.prisma = prisma;
