"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatThaiDateTime } from "@/lib/thai-date";
import { postJson } from "./client-api";
import { useConfirmDialog } from "./ConfirmDialog";

type HistoryItem = { action: string; createdAt: string };

export function MaintenancePanel({ initialEnabled, history }: { initialEnabled: boolean; history: HistoryItem[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => setEnabled(initialEnabled), [initialEnabled]);

  async function toggle() {
    const next = !enabled;
    const accepted = await confirm(
      next
        ? "หน้าค้นหาและการดาวน์โหลดสาธารณะจะหยุดชั่วคราว หลังบ้านยังใช้งานได้ ต้องการปิดปรับปรุงตอนนี้หรือไม่?"
        : "หน้าค้นหาและการดาวน์โหลดสาธารณะจะกลับมาใช้งานได้ทันที ตรวจข้อมูลก่อนเปิดให้ผู้ปกครองหรือยัง?",
      {
        title: next ? "ยืนยันปิดปรับปรุง" : "ยืนยันเปิดเว็บไซต์",
        confirmLabel: next ? "ปิดปรับปรุง" : "เปิดเว็บไซต์",
        tone: next ? "danger" : "brand",
      },
    );
    if (!accepted) return;
    setBusy(true);
    setError(null);
    const result = await postJson<{ enabled: boolean }>(
      "/api/admin/maintenance",
      { enabled: next, expectedEnabled: enabled },
      "PATCH",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      if (result.code === "STALE") router.refresh();
      return;
    }
    setEnabled(result.enabled);
    router.refresh();
  }

  return (
    <section aria-labelledby="maintenance-heading" className="mb-6 rounded-2xl border border-hairline bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="maintenance-heading" className="text-lg font-semibold text-ink">สถานะหน้าค้นหาสาธารณะ</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-soft">
            ใช้ระหว่างอัปเดตระบบหรือนำเข้าข้อมูลใหม่ หลังบ้านยังใช้งานได้ แต่ผู้ปกครองจะค้นหาและขอลิงก์ดาวน์โหลดใหม่ไม่ได้
          </p>
          <p role="status" className="mt-3 font-medium text-ink">
            {enabled ? "● ปิดปรับปรุงอยู่" : "● เปิดให้ค้นหาอยู่"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`min-h-11 cursor-pointer rounded-xl px-4 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60 ${enabled ? "bg-brand text-white" : "border border-danger-ink text-danger-ink"}`}
        >
          {busy ? "กำลังบันทึก..." : enabled ? "เปิดเว็บไซต์อีกครั้ง" : "ปิดปรับปรุงชั่วคราว"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
      {history.length > 0 && (
        <details className="mt-4 border-t border-hairline pt-3 text-sm text-ink-soft">
          <summary className="cursor-pointer font-medium">ประวัติการเปิด–ปิดล่าสุด</summary>
          <ul className="mt-2 space-y-1">
            {history.map((item, index) => (
              <li key={`${item.createdAt}-${index}`}>
                {formatThaiDateTime(item.createdAt)} · {item.action === "MAINTENANCE_ENABLED" ? "ปิดปรับปรุง" : "เปิดเว็บไซต์"}
              </li>
            ))}
          </ul>
        </details>
      )}
      {dialog}
    </section>
  );
}
