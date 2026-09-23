import { MedalIcon } from "./icons";

/** ป้ายรางวัล — สิ่งแรกที่ผู้ปกครองกวาดตาหา
 *
 *  แต่ละรางวัลมีสีของตัวเอง เพื่อให้แยกออกตั้งแต่ยังไม่อ่าน
 *  แต่ **ต้องมีทั้งข้อความและไอคอนกำกับเสมอ** ห้ามสื่อความหมายด้วยสีอย่างเดียว
 *  คนตาบอดสีและคนที่พิมพ์หน้าเว็บออกมาขาวดำต้องอ่านออกเหมือนกัน
 *
 *  ชื่อรางวัลเป็นของรายการนั้นจริง ๆ (เช่น BBB เป็น "รางวัลที่ 1" ไม่ใช่เหรียญทอง)
 *  สีมาจากแคตตาล็อกรางวัล (shared/certificate-profiles/*.json ช่อง badge) */
const TONES: Record<string, string> = {
  gold: "bg-gold-bg text-gold-ink border-gold-line",
  silver: "bg-silver-bg text-silver-ink border-silver-line",
  bronze: "bg-bronze-bg text-bronze-ink border-bronze-line",
  merit: "bg-merit-bg text-merit-ink border-merit-line",
  perfect: "bg-perfect-bg text-perfect-ink border-perfect-line",
  participation: "bg-participation-bg text-participation-ink border-participation-line",
  special: "bg-special-bg text-special-ink border-special-line",
};

export function AwardBadge({
  label,
  labelTh,
  badge,
  className = "",
}: {
  label: string;
  labelTh?: string | null;
  badge: string;
  className?: string;
}) {
  const tone = TONES[badge] ?? "bg-silver-bg text-silver-ink border-silver-line";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5
                  text-sm font-semibold sm:px-3 sm:py-1 sm:text-base ${tone} ${className}`}
      title={label}
    >
      <MedalIcon className="h-4 w-4 shrink-0" />
      {labelTh ?? label}
    </span>
  );
}
