"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * อายุการเก็บของรอบนำเข้านี้
 *
 * แสดงวันที่ไฟล์จะถูกลบให้เห็นตั้งแต่วันแรก ไม่ใช่ให้ไปรู้ตอนของหายไปแล้ว
 * และมีปุ่มต่ออายุเผื่อมีคนขอ
 */
export function RetentionPanel({
  batchId,
  expiresAt,
  certificates,
  deletedFiles,
}: {
  batchId: string;
  /** วันหมดอายุที่เร็วที่สุดของรอบนี้ — null = ยังไม่เผยแพร่ จึงยังไม่เริ่มนับ */
  expiresAt: string | null;
  certificates: number;
  /** จำนวนใบที่ไฟล์ถูกลบไปแล้วเพราะครบอายุ */
  deletedFiles: number;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function extend() {
    setMessage(null);
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/batches/${batchId}/extend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: 12 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "ต่ออายุไม่สำเร็จ");
      setMessage("ต่ออายุอีก 1 ปีแล้ว");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "ต่ออายุไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  const date = expiresAt
    ? new Date(expiresAt).toLocaleDateString("th-TH", { dateStyle: "long" })
    : null;

  return (
    <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-sm">
      {deletedFiles > 0 ? (
        <p className="text-ink">
          ครบอายุการเก็บแล้ว — ลบไฟล์ไป {deletedFiles} ใบ ข้อมูลยังอยู่ในระบบแต่ผู้ปกครองค้นไม่เจอ
        </p>
      ) : date ? (
        <p className="text-ink">
          เกียรติบัตร {certificates} ใบของรอบนี้จะถูกลบไฟล์วันที่ <b>{date}</b>
        </p>
      ) : (
        <p className="text-ink-soft">ยังไม่ได้เผยแพร่ จึงยังไม่เริ่มนับอายุการเก็บ</p>
      )}

      {date && deletedFiles === 0 && (
        <button
          type="button"
          onClick={extend}
          disabled={working}
          className="mt-2 min-h-10 cursor-pointer rounded-xl border px-3 text-sm transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 border-hairline hover:bg-paper"
        >
          {working ? "กำลังต่ออายุ..." : "ต่ออายุอีก 1 ปี"}
        </button>
      )}

      {message && <p className="mt-2 text-ink-soft">{message}</p>}
    </div>
  );
}
