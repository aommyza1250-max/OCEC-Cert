import { describe, expect, it } from "vitest";
import { auditCandidateNo, visibleAuditChanges } from "./audit-display";

describe("admin audit presentation", () => {
  it("shows readable participant changes but never exposes internal identifiers", () => {
    const changes = visibleAuditChanges(
      { candidateNo: "9001", examMode: "ONLINE", rosterEntryId: "internal-entry", studentId: "internal-student" },
      { candidateNo: "9001", examMode: "ONSITE", rosterEntryId: "internal-entry", jobId: "internal-job" },
    );
    expect(changes).toEqual([{ label: "รูปแบบการสอบ", before: "Online", after: "Onsite" }]);
    expect(JSON.stringify(changes)).not.toMatch(/internal-|rosterEntryId|studentId|jobId/);
  });

  it("uses award names and human-readable statuses", () => {
    const changes = visibleAuditChanges(
      { award: "1ST_PRIZE", status: "READY" },
      { award: "2ND_PRIZE", status: "PUBLISHED" },
      "BBB",
    );
    expect(changes).toContainEqual({ label: "สถานะ", before: "พร้อมใช้งาน", after: "เผยแพร่แล้ว" });
    expect(changes.find((change) => change.label === "รางวัล")?.after).not.toBe("2ND_PRIZE");
  });

  it("does not render nested job payloads or file storage keys", () => {
    const changes = visibleAuditChanges(null, {
      candidateNo: "9002",
      resolutions: [{ rosterEntryId: "internal-entry" }],
      pdfKey: "private/storage/key",
      fileName: "sample.pdf",
    });
    expect(changes).toEqual([
      { label: "เลขผู้เข้าสอบ", before: undefined, after: "9002" },
      { label: "ชื่อไฟล์", before: undefined, after: "sample.pdf" },
    ]);
    expect(auditCandidateNo({ candidateNo: "9001" }, null)).toBe("9001");
  });

  it("explains a manual roster conflict decision", () => {
    expect(visibleAuditChanges(null, { action: "KEEP_MANUAL", fields: { rosterEntryId: "hidden" } }))
      .toEqual([{ label: "คำตัดสิน", before: undefined, after: "เก็บรายการที่เพิ่มเอง" }]);
  });
});
