import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IdentityPanel } from "./IdentityPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./ConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) }));

it("เสนอให้เปลี่ยนตัวคนแม้เพิ่งกดคนใหม่และยังไม่มีใบของรายการอื่น", () => {
  const html = renderToStaticMarkup(createElement(IdentityPanel, {
    entryId: "synthetic-entry",
    candidateNo: "9002",
    version: 1,
    linked: { id: "new-person", name: "SOMCHAI JAIDEE", school: null },
    otherCertificates: 0,
    candidates: [{
      id: "heat-person", name: "SOMCHAI JAIDEE", school: "SAMPLE SCHOOL",
      certificates: ["HKIMO HEAT 2092 Bronze Award"],
    }],
    locked: null,
  }));

  expect(html).toContain("เปลี่ยนตัวคนที่ผูก");
  expect(html).toContain("พิมพ์เลขผู้เข้าสอบ 9002 เพื่อยืนยัน");
  expect(html).toContain("HKIMO HEAT 2092 Bronze Award");
  expect(html).not.toContain("ผูกผิดคน — แยกเป็นคนใหม่");
});
