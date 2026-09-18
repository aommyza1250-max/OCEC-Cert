"use client";

import Link from "next/link";
import { useState } from "react";

export type ExpiringGroup = {
  batchId: string;
  label: string;
  count: number;
  expiresAt: string;
};

/**
 * รอบที่ใกล้ครบอายุการเก็บ
 *
 * ขึ้นเฉพาะตอนมีของใกล้ครบจริง ๆ ไม่ใช่กินที่หน้าจอทุกวัน
 * มีปุ่ม "ลองดูว่าจะลบอะไร" ไว้ให้ตรวจก่อนถึงวันจริงได้ทุกเมื่อ
 */
export function ExpiringSoon({ groups }: { groups: ExpiringGroup[] }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function dryRun() {
    setMessage(null);
    setChecking(true);
    try {
      const res = await fetch("/api/admin/retention", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "สั่งตรวจไม่สำเร็จ");
      setMessage("สั่งตรวจแล้ว ผลจะขึ้นใน log ของ worker ภายในไม่กี่วินาที");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "สั่งตรวจไม่สำเร็จ");
    } finally {
      setChecking(false);
    }
  }

  if (groups.length === 0) return null;

  return (
    <section className="mt-8 rounded-xl border border-warn-line bg-warn-bg p-5">
      <h2 className="font-semibold text-warn-ink">ใกล้ครบอายุการเก็บใน 30 วัน</h2>
      <p className="mt-1 text-sm text-warn-ink">
        ครบกำหนดแล้วไฟล์จะถูกลบ ผู้ปกครองจะค้นไม่เจอ ถ้ายังต้องใช้ให้เข้าไปต่ออายุที่รอบนั้น
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {groups.map((group) => (
          <li key={group.batchId}>
            <Link href={`/admin/batches/${group.batchId}`} className="underline">
              {group.label}
            </Link>{" "}
            <span className="text-ink-soft">
              {group.count} ใบ · ครบวันที่{" "}
              {new Date(group.expiresAt).toLocaleDateString("th-TH", { dateStyle: "long" })}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={dryRun}
        disabled={checking}
        className="mt-3 min-h-10 cursor-pointer rounded-xl border px-3 text-sm transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 border-warn-line bg-card hover:bg-warn-bg"
      >
        {checking ? "กำลังสั่ง..." : "ลองดูว่าจะลบอะไรบ้าง (ไม่ลบจริง)"}
      </button>

      {message && <p className="mt-2 text-sm text-warn-ink">{message}</p>}
    </section>
  );
}
