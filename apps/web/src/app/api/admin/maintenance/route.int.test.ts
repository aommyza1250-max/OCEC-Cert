/** ใช้ฐานข้อมูลทดสอบแยกเท่านั้น ห้ามรันกับฐาน production หรือ dev */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ sessionId: "maintenance-test" }) }));

describe.skipIf(!url || url.endsWith("/ocec"))("โหมดปิดปรับปรุง", async () => {
  const { prisma } = await import("@/lib/db");
  const { isMaintenanceEnabled } = await import("@/lib/maintenance");
  const { PATCH } = await import("./route");
  const { GET: download } = await import("../../certificates/[id]/download/route");

  const update = (enabled: boolean, expectedEnabled: boolean) =>
    PATCH(
      new Request("http://test/api/admin/maintenance", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, expectedEnabled }),
      }),
      { params: Promise.resolve({}) },
    );

  beforeEach(async () => {
    await prisma.siteSetting.upsert({
      where: { id: 1 },
      create: { id: 1, maintenanceEnabled: false },
      update: { maintenanceEnabled: false },
    });
  });

  afterEach(async () => {
    await prisma.siteSetting.update({ where: { id: 1 }, data: { maintenanceEnabled: false } });
    await prisma.auditEvent.deleteMany({ where: { sessionId: "maintenance-test" } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("ปิดแล้วดาวน์โหลดไม่ได้ เปิดกลับแล้วสถานะปกติ และมี audit ทั้งสองครั้ง", async () => {
    expect(await isMaintenanceEnabled()).toBe(false);
    expect((await update(true, false)).status).toBe(200);
    expect(await isMaintenanceEnabled()).toBe(true);
    const blocked = await download(
      new Request("http://test/api/certificates/example/download"),
      { params: Promise.resolve({ id: "example" }) },
    );
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect((await update(false, true)).status).toBe(200);
    expect(await isMaintenanceEnabled()).toBe(false);
    const events = await prisma.auditEvent.findMany({ where: { sessionId: "maintenance-test" }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["MAINTENANCE_ENABLED", "MAINTENANCE_DISABLED"]);
  });

  it("กันการกดจากหน้าแอดมินที่ถือสถานะเก่าและไม่บันทึก audit ซ้ำ", async () => {
    expect((await update(true, false)).status).toBe(200);
    expect((await update(true, false)).status).toBe(409);
    expect(await prisma.auditEvent.count({ where: { sessionId: "maintenance-test" } })).toBe(1);
  });

  it("ปฏิเสธ payload ที่ไม่ใช่ boolean", async () => {
    const response = await PATCH(
      new Request("http://test/api/admin/maintenance", {
        method: "PATCH", body: JSON.stringify({ enabled: "true", expectedEnabled: false }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    expect(await isMaintenanceEnabled()).toBe(false);
  });
});
