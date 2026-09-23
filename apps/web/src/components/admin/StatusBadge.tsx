/**
 * ป้ายสถานะของหลังบ้าน — ที่เดียวสำหรับทั้งระบบ (ทั้งสถานะรอบนำเข้า และสถานะของหน้าเกียรติบัตร)
 *
 * เดิมข้อความและสีถูกเขียนซ้ำในหลายหน้า พอเพิ่มสถานะใหม่ก็ลืมแก้บางที่
 * จนหน้าหนึ่งขึ้นภาษาไทย อีกหน้าขึ้น DELETING ดิบ ๆ
 */
const NEUTRAL = "bg-paper text-ink-soft border-hairline";
const BRAND = "bg-brand-soft text-brand border-brand-line";
const WARN = "bg-warn-bg text-warn-ink border-warn-line";
const OK = "bg-ok-bg text-ok-ink border-ok-line";
const DANGER = "bg-danger-bg text-danger-ink border-danger-line";

const STATUS: Record<string, { text: string; className: string }> = {
  DRAFT: { text: "ยังไม่มีรายชื่อ", className: NEUTRAL },
  SPLITTING: { text: "กำลังตัดแยกหน้า", className: BRAND },
  // สถานะของระบบเดิม — ขั้นตอนใหม่ไม่ได้ตั้งค่านี้แล้ว แต่รอบเก่ายังมีอยู่
  SPLIT_DONE: { text: "ตัดเสร็จ รอรายชื่อ", className: BRAND },
  MATCHING: { text: "กำลังจับคู่รายชื่อ", className: BRAND },
  READY: { text: "ยังไม่เผยแพร่", className: WARN },
  PUBLISHED: { text: "เผยแพร่แล้ว", className: OK },
  FAILED: { text: "ล้มเหลว", className: DANGER },
  DELETING: { text: "กำลังลบ", className: DANGER },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.text ?? status;
}

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const tone = STATUS[status] ?? { text: status, className: NEUTRAL };
  return <Badge text={tone.text} tone={tone.className} className={className} />;
}

/** สถานะของหน้าเกียรติบัตร 1 หน้า */
const PAGE_STATUS: Record<string, { text: string; className: string }> = {
  MATCHED: { text: "จับคู่แล้ว", className: OK },
  UNMATCHED: { text: "ยังไม่มีคู่", className: WARN },
  NAME_MISMATCH: { text: "ชื่อไม่ตรง", className: WARN },
  MODE_MISMATCH: { text: "online/onsite ไม่ตรง", className: WARN },
  AMBIGUOUS: { text: "ระบุตัวไม่ได้", className: WARN },
  DUPLICATE_NAME: { text: "ใบซ้ำ รอตัดสิน", className: WARN },
  NATIONALITY_UNVERIFIED: { text: "รอยืนยันสัญชาติ", className: WARN },
  PARSE_REVIEW: { text: "รอบ/ปีไม่ตรง", className: WARN },
  DISCARDED: { text: "ทิ้งแล้ว", className: NEUTRAL },
  SUPERSEDED: { text: "มีไฟล์ใหม่มาแทน", className: NEUTRAL },
  SKIPPED_FOREIGN: { text: "ต่างชาติ (ข้าม)", className: NEUTRAL },
};

export function pageStatusLabel(status: string): string {
  return PAGE_STATUS[status]?.text ?? status;
}

export function PageStatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const tone = PAGE_STATUS[status] ?? { text: status, className: NEUTRAL };
  return <Badge text={tone.text} tone={tone.className} className={className} />;
}

/** รูปแบบการสอบ — ใช้ในหลังบ้านเท่านั้น หน้าค้นหาสาธารณะไม่แสดงเด็ดขาด */
export function ModeBadge({ mode, className = "" }: { mode: string | null; className?: string }) {
  const text = mode === "ONLINE" ? "Online" : mode === "ONSITE" ? "Onsite" : "ไม่ระบุ";
  return <Badge text={text} tone={mode ? BRAND : NEUTRAL} className={className} />;
}

function Badge({ text, tone, className }: { text: string; tone: string; className: string }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone} ${className}`}>
      {text}
    </span>
  );
}
