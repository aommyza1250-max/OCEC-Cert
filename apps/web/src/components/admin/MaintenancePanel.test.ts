import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.stubGlobal("React", React);

import { MaintenancePanel } from "./MaintenancePanel";

describe("แถบปิดปรับปรุง", () => {
  it.each([
    [false, "ใช้งานปกติ", "bg-ok-ink"],
    [true, "ปิดการค้นหา", "bg-danger-ink"],
  ])("แสดงสถานะ %s พร้อมสวิตช์ที่เข้าถึงได้", (enabled, label, dotClass) => {
    const html = renderToStaticMarkup(createElement(MaintenancePanel, { initialEnabled: enabled, history: [] }));
    expect(html).toContain("ระบบปิดปรับปรุง");
    expect(html).toContain("ปิดการค้นหา และปิดการขอลิงก์ดาวน์โหลด");
    expect(html).toContain(label);
    expect(html).toContain(dotClass);
    expect(html).toContain(`role="switch" aria-label="โหมดปิดปรับปรุง" aria-checked="${enabled}"`);
    expect(html).toContain("h-11 w-16");
  });
});
