/**
 * ป้ายสถานะของรอบการนำเข้า — ที่เดียวสำหรับทั้งระบบหลังบ้าน
 *
 * เดิมข้อความและสีถูกเขียนซ้ำในหลายหน้า พอเพิ่มสถานะใหม่ก็ลืมแก้บางที่
 * จนหน้าหนึ่งขึ้นภาษาไทย อีกหน้าขึ้น DELETING ดิบ ๆ
 */
const STATUS: Record<string, { text: string; className: string }> = {
  DRAFT: { text: "ยังไม่อัปโหลด ZIP", className: "bg-paper text-ink-soft border-hairline" },
  SPLITTING: { text: "กำลังตัดแยกหน้า", className: "bg-brand-soft text-brand border-brand-line" },
  SPLIT_DONE: { text: "ตัดเสร็จ รอรายชื่อ", className: "bg-brand-soft text-brand border-brand-line" },
  MATCHING: { text: "กำลังจับคู่รายชื่อ", className: "bg-brand-soft text-brand border-brand-line" },
  READY: { text: "รอตรวจและเผยแพร่", className: "bg-warn-bg text-warn-ink border-warn-line" },
  PUBLISHED: { text: "เผยแพร่แล้ว", className: "bg-ok-bg text-ok-ink border-ok-line" },
  FAILED: { text: "ล้มเหลว", className: "bg-danger-bg text-danger-ink border-danger-line" },
  DELETING: { text: "กำลังลบ", className: "bg-danger-bg text-danger-ink border-danger-line" },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.text ?? status;
}

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const tone = STATUS[status] ?? { text: status, className: "bg-paper text-ink-soft border-hairline" };
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium
                  ${tone.className} ${className}`}
    >
      {tone.text}
    </span>
  );
}
