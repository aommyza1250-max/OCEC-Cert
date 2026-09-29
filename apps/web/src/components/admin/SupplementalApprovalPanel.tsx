"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./client-api";
import { useConfirmDialog } from "./ConfirmDialog";

/** ให้ย้อนการยืนยันที่กดผิดได้ ก่อนเผยแพร่หรือหลังยกเลิกการเผยแพร่ */
export function SupplementalApprovalPanel({
  entryId,
  version,
  current,
  locked,
}: {
  entryId: string;
  version: number;
  current: boolean;
  locked: string | null;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!(await confirm(
      "ยกเลิกการยืนยันรางวัลเสริมของผู้เข้าสอบคนนี้? หากยังไม่มีรางวัลหลัก ระบบจะพักใบไว้ให้ตรวจอีกครั้ง",
      { title: "ยกเลิกการยืนยัน", confirmLabel: "ยกเลิกการยืนยัน", tone: "brand" },
    ))) return;
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/admin/participants/${entryId}/supplemental-only`, {
      action: "REVOKE", version,
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <section className="space-y-2 rounded-xl border border-hairline bg-card p-4 text-sm">
      {dialog}
      <h2 className="font-semibold">การตรวจรางวัลเสริม</h2>
      <p className={current ? "text-ok-ink" : "text-warn-ink"}>
        {current
          ? "แอดมินยืนยันให้ใช้เฉพาะใบรางวัลเสริมชุดปัจจุบันแล้ว"
          : "ไฟล์หรือรางวัลเปลี่ยนไปจากตอนยืนยัน ต้องตรวจและยืนยันชุดปัจจุบันใหม่"}
      </p>
      <button
        type="button"
        onClick={() => void revoke()}
        disabled={busy || Boolean(locked)}
        className="min-h-11 cursor-pointer rounded-xl border border-hairline px-3 font-medium text-ink-soft transition duration-200 hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "กำลังยกเลิก..." : "ยกเลิกการยืนยัน"}
      </button>
      {locked && <p className="text-ink-soft">{locked}</p>}
      {error && <p role="alert" className="text-danger-ink">{error}</p>}
    </section>
  );
}
