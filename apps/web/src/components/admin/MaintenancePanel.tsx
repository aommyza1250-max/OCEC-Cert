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
    <section aria-labelledby="maintenance-heading" className="mb-5 rounded-xl border border-hairline bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-0">
          <h2 id="maintenance-heading" className="text-sm font-semibold text-ink sm:text-base">ระบบปิดปรับปรุง</h2>
          <p className="text-xs leading-5 text-ink-soft sm:text-sm">ปิดการค้นหา และปิดการขอลิงก์ดาวน์โหลด</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p role="status" className={`flex items-center gap-2 text-sm font-medium ${enabled ? "text-danger-ink" : "text-ok-ink"}`}>
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${enabled ? "bg-danger-ink" : "bg-ok-ink"}`} />
            {busy ? "กำลังบันทึก..." : enabled ? "ปิดการค้นหา" : "ใช้งานปกติ"}
          </p>
          <button
            type="button"
            role="switch"
            aria-label="โหมดปิดปรับปรุง"
            aria-checked={enabled}
            aria-busy={busy}
            onClick={toggle}
            disabled={busy}
            className={`relative h-11 w-16 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60 ${enabled ? "border-danger-ink bg-danger-ink" : "border-hairline bg-hairline"}`}
          >
            <span aria-hidden="true" className={`absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white shadow transition-[left] ${enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
      {history.length > 0 && (
        <details className="mt-2 text-xs text-ink-soft">
          <summary className="w-fit cursor-pointer font-medium underline underline-offset-2">ประวัติการเปิด–ปิด</summary>
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
