import { prisma } from "./db";

/** อ่านจาก DB ทุก request เพื่อให้สวิตช์มีผลทันทีในทุก instance ของ Railway */
export async function isMaintenanceEnabled(): Promise<boolean> {
  const setting = await prisma.siteSetting.findUnique({
    where: { id: 1 },
    select: { maintenanceEnabled: true },
  });
  return setting?.maintenanceEnabled ?? false;
}
