import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";

const schema = z.object({
  enabled: z.boolean(),
  expectedEnabled: z.boolean(),
}).refine((body) => body.enabled !== body.expectedEnabled, {
  message: "สถานะที่ต้องการตรงกับสถานะเดิมอยู่แล้ว",
});

export const PATCH = adminHandler(async (request, { session }) => {
  const { enabled, expectedEnabled } = await parseBody(request, schema);
  await prisma.$transaction(async (tx) => {
    const result = await tx.siteSetting.updateMany({
      where: { id: 1, maintenanceEnabled: expectedEnabled },
      data: { maintenanceEnabled: enabled },
    });
    if (result.count !== 1) {
      throw new HttpError(409, "สถานะเว็บไซต์เปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่", { code: "STALE" });
    }
    await tx.auditEvent.create({
      data: {
        entityType: "SITE",
        entityId: "maintenance",
        action: enabled ? "MAINTENANCE_ENABLED" : "MAINTENANCE_DISABLED",
        before: { enabled: expectedEnabled },
        after: { enabled },
        sessionId: session.sessionId,
      },
    });
  });
  return NextResponse.json({ enabled });
});
