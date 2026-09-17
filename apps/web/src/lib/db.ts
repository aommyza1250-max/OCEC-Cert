import { PrismaClient } from "@prisma/client";

/**
 * Next.js dev mode รีโหลดโมดูลทุกครั้งที่แก้ไฟล์ ถ้าไม่ cache ไว้บน globalThis
 * จะเปิด connection pool ใหม่เรื่อย ๆ จน Postgres ปฏิเสธการเชื่อมต่อ
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
