import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/maintenance", () => ({ isMaintenanceEnabled: async () => true }));
vi.mock("@/lib/search", () => ({ searchStudents: () => { throw new Error("search must not run"); } }));
vi.stubGlobal("React", React);

import HomePage from "./page";

describe("หน้าค้นหาระหว่างปิดปรับปรุง", () => {
  it("ไม่ค้นหาหรือแสดงฟอร์มค้นหา แม้ URL มี q", async () => {
    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({ q: "SOMCHAI" }),
      }),
    );
    expect(markup).toContain("ระบบปิดปรับปรุงชั่วคราว");
    expect(markup).not.toContain("name=\"q\"");
    expect(markup).not.toContain("ผลค้นหา");
  });
});
