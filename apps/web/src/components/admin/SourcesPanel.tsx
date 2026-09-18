"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * สถานะไฟล์ต้นฉบับ (ZIP) ของรอบนำเข้านี้
 *
 * ZIP กินที่มากที่สุดในระบบ (ราว 360 MB ต่อรอบ) และหลังจับคู่เสร็จก็ไม่มีอะไรเรียกใช้อีก
 * ระบบจึงเคลียร์ให้เองเมื่อเงื่อนไขครบ ส่วนแผงนี้มีไว้ให้แอดมินรู้ว่าเกิดอะไรขึ้น
 * ไม่ใช่ปล่อยให้ไฟล์หายไปเฉย ๆ แล้วมาสงสัยทีหลัง
 */
export function SourcesPanel({
  batchId,
  clearedAt,
  blockers,
}: {
  batchId: string;
  clearedAt: string | null;
  /** เหตุผลที่ยังเคลียร์ไม่ได้ จากการตรวจครั้งล่าสุดของ worker — null = ยังไม่เคยตรวจ */
  blockers: string[] | null;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearNow() {
    setError(null);
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/batches/${batchId}/cleanup-sources`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "สั่งเคลียร์ไม่สำเร็จ");
      // ไม่ต้องรอผล งานนี้ใช้เวลาไม่นานและหน้าจะอัปเดตตอนรีเฟรช
      setTimeout(() => router.refresh(), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สั่งเคลียร์ไม่สำเร็จ");
      setWorking(false);
    }
  }

  if (clearedAt) {
    return (
      <p className="rounded-2xl border border-hairline bg-card px-4 py-3 text-sm text-ink-soft">
        ไฟล์ต้นฉบับถูกเคลียร์แล้วเมื่อ{" "}
        {new Date(clearedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}{" "}
        — เก็บไฟล์รายชื่อ (Excel) ไว้ ส่วนเกียรติบัตรและรูปตัวอย่างอยู่ครบเหมือนเดิม
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-sm">
      <p className="font-medium text-ink">ไฟล์ต้นฉบับ (ZIP) ยังอยู่</p>
      {blockers === null ? (
        <p className="mt-1 text-ink-soft">
          ระบบจะเคลียร์ให้เองหลังเผยแพร่ ถ้าจับคู่ครบทุกคนและไม่มีอะไรค้าง
        </p>
      ) : blockers.length > 0 ? (
        <>
          <p className="mt-1 text-ink-soft">ยังเคลียร์ไม่ได้เพราะ</p>
          <ul className="mt-1 list-inside list-disc text-ink-soft">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-ink-soft">เงื่อนไขครบแล้ว กำลังรอรอบทำงานถัดไป</p>
      )}

      <button
        type="button"
        onClick={clearNow}
        disabled={working}
        className="mt-2 min-h-10 cursor-pointer rounded-xl border px-3 text-sm transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 border-hairline hover:bg-paper"
      >
        {working ? "กำลังสั่ง..." : "ตรวจและเคลียร์เดี๋ยวนี้"}
      </button>

      {error && <p className="mt-2 text-sm text-danger-ink">{error}</p>}
    </div>
  );
}
