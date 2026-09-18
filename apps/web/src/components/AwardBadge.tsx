import { AWARD_LABELS } from "@/lib/normalize";
import { MedalIcon } from "./icons";

/** ป้ายรางวัล — สิ่งแรกที่ผู้ปกครองกวาดตาหา
 *
 *  แต่ละรางวัลมีสีของตัวเอง เพื่อให้แยกออกตั้งแต่ยังไม่อ่าน
 *  แต่ **ต้องมีทั้งข้อความและไอคอนกำกับเสมอ** ห้ามสื่อความหมายด้วยสีอย่างเดียว
 *  คนตาบอดสีและคนที่พิมพ์หน้าเว็บออกมาขาวดำต้องอ่านออกเหมือนกัน */
const TONES: Record<string, string> = {
  GOLD: "bg-gold-bg text-gold-ink border-gold-line",
  SILVER: "bg-silver-bg text-silver-ink border-silver-line",
  BRONZE: "bg-bronze-bg text-bronze-ink border-bronze-line",
  MERIT: "bg-merit-bg text-merit-ink border-merit-line",
  PERFECT_SCORE: "bg-perfect-bg text-perfect-ink border-perfect-line",
};

export function AwardBadge({ award, className = "" }: { award: string; className?: string }) {
  const tone = TONES[award] ?? "bg-silver-bg text-silver-ink border-silver-line";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1
                  text-base font-semibold ${tone} ${className}`}
    >
      <MedalIcon className="h-4 w-4 shrink-0" />
      {AWARD_LABELS[award] ?? award}
    </span>
  );
}
