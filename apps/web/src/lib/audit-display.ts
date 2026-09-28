import { pageStatusLabel, statusLabel } from "@/components/admin/StatusBadge";
import { awardDisplay } from "./certificate-catalog";

const FIELD_LABELS: Record<string, string> = {
  candidateNo: "เลขผู้เข้าสอบ",
  nameEn: "ชื่ออังกฤษ",
  nameTh: "ชื่อไทย",
  examMode: "รูปแบบการสอบ",
  school: "โรงเรียน",
  level: "ระดับชั้น",
  source: "ที่มาของรายชื่อ",
  status: "สถานะ",
  award: "รางวัล",
  folderAward: "รางวัลจากโฟลเดอร์",
  fileName: "ชื่อไฟล์",
  policy: "การเผยแพร่ใบรางวัลเสริม",
  purpose: "การอัปไฟล์",
  printedMode: "รูปแบบบนใบ",
  zipMode: "รูปแบบจาก ZIP",
  rosterMode: "รูปแบบตามรายชื่อ",
  total: "ผู้เข้าสอบทั้งหมด",
  online: "Online",
  onsite: "Onsite",
  created: "เพิ่มจาก Excel",
  updated: "แก้ตาม Excel",
  deleted: "นำออกจาก Excel",
  merged: "รวมกับรายการที่เพิ่มเอง",
  otherCertificates: "เกียรติบัตรรายการอื่น",
  action: "คำตัดสิน",
};

export type AuditChange = { label: string; before?: string; after?: string };

const ROSTER_STATUS: Record<string, string> = {
  PENDING: "กำลังตรวจ",
  INVALID: "ตรวจไม่ผ่าน",
  READY: "พร้อมใช้งาน",
  ACTIVATING: "กำลังใช้รายชื่อ",
  ACTIVE: "ใช้อยู่",
  SUPERSEDED: "ถูกแทนด้วยชุดใหม่",
};

/** เลือกเฉพาะข้อมูลที่เจ้าหน้าที่ใช้ตรวจย้อนหลังได้; รหัสภายในและ payload งานไม่ออกหน้าเว็บ */
export function visibleAuditChanges(before: unknown, after: unknown, programCode?: string): AuditChange[] {
  const oldValues = asRecord(before);
  const newValues = asRecord(after);
  return Object.entries(FIELD_LABELS).flatMap(([field, label]) => {
    const oldValue = readable(field, oldValues[field], programCode);
    const newValue = readable(field, newValues[field], programCode);
    if (oldValue === undefined && newValue === undefined) return [];
    if (oldValue === newValue && field in oldValues && field in newValues) return [];
    return [{ label, before: field in oldValues ? oldValue : undefined, after: field in newValues ? newValue : undefined }];
  });
}

export function auditCandidateNo(before: unknown, after: unknown): string | null {
  const value = asRecord(after).candidateNo ?? asRecord(before).candidateNo;
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readable(field: string, value: unknown, programCode?: string): string | undefined {
  if (value === null || value === "") return "—";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  const text = String(value);
  if (field === "status") {
    if (text in ROSTER_STATUS) return ROSTER_STATUS[text];
    return pageStatusLabel(text) === text ? statusLabel(text) : pageStatusLabel(text);
  }
  if (field === "award" || field === "folderAward") return programCode ? awardDisplay(programCode, text).label : text;
  if (["examMode", "printedMode", "zipMode", "rosterMode"].includes(field)) {
    return text === "ONLINE" ? "Online" : text === "ONSITE" ? "Onsite" : text;
  }
  if (field === "source") return text === "MANUAL" ? "เพิ่มเอง" : text === "EXCEL" ? "จาก Excel" : text;
  if (field === "purpose") return text === "replace" ? "เปลี่ยนไฟล์" : text === "add" ? "เพิ่มใบ" : text;
  if (field === "policy") {
    return text === "ALL" ? "ทุกใบ" : text === "MEDAL_ONLY" ? "เฉพาะใบรางวัลหลัก" : "ยังไม่เลือก";
  }
  if (field === "action") {
    if (text === "MERGE") return "รวมกับรายชื่อ Excel";
    if (text === "KEEP_MANUAL") return "เก็บรายการที่เพิ่มเอง";
    if (text === "LINK") return "เลือกตัวคนเดิม";
    if (text === "NEW") return "แยกเป็นคนใหม่";
    return undefined;
  }
  return text;
}
