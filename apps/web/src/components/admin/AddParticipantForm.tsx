"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./client-api";

export type ParticipantDraft = {
  candidateNo?: string | null;
  nameEn?: string | null;
  nameTh?: string | null;
  examMode?: "ONLINE" | "ONSITE" | null;
  school?: string | null;
  level?: string | null;
};

/**
 * เพิ่มผู้เข้าสอบที่ตกหล่นจาก Excel — รายการนี้รอดจากการอัป Excel ชุดใหม่เสมอ
 * เพิ่มแล้วระบบจับคู่ใหม่ทันที ถ้ามีหน้ารอเลขนี้อยู่ จะได้ใบทันที ไม่มีก็ไปอยู่ในรายการที่ต้องตามเก็บ
 */
export function AddParticipantForm({
  batchId,
  initial,
  locked,
}: {
  batchId: string;
  initial?: ParticipantDraft;
  locked: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    candidateNo: initial?.candidateNo ?? "",
    nameEn: initial?.nameEn ?? "",
    nameTh: initial?.nameTh ?? "",
    examMode: initial?.examMode ?? "",
    school: initial?.school ?? "",
    level: initial?.level ?? "",
    rawAward: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson<{ id: string }>(`/api/admin/batches/${batchId}/participants`, form);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.push(`/admin/batches/${batchId}/participants/${result.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-hairline bg-card p-4">
      <p className="font-medium">เพิ่มผู้เข้าสอบที่ตกหล่นจาก Excel</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="เลขผู้เข้าสอบ *" value={form.candidateNo} onChange={set("candidateNo")} inputMode="numeric" />
        <fieldset className="text-sm">
          <legend className="mb-1 text-ink-soft">รูปแบบการสอบ *</legend>
          <div className="flex gap-4">
            {(["ONLINE", "ONSITE"] as const).map((mode) => (
              <label key={mode} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="examMode"
                  checked={form.examMode === mode}
                  onChange={() => setForm((f) => ({ ...f, examMode: mode }))}
                />
                {mode === "ONLINE" ? "Online" : "Onsite"}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="ชื่อ-นามสกุล (อังกฤษ)" value={form.nameEn} onChange={set("nameEn")} />
        <Field label="ชื่อ-นามสกุล (ไทย)" value={form.nameTh} onChange={set("nameTh")} />
        <Field label="โรงเรียน" value={form.school} onChange={set("school")} />
        <Field label="ระดับชั้น" value={form.level} onChange={set("level")} />
        <Field
          label="รางวัลที่คาดไว้ (ไว้ตามเก็บไฟล์เท่านั้น)"
          value={form.rawAward}
          onChange={set("rawAward")}
        />
      </div>
      {error && <p className="text-sm text-danger-ink">{error}</p>}
      <button
        type="submit"
        disabled={busy || Boolean(locked) || !form.candidateNo.trim() || !form.examMode || !(form.nameEn.trim() || form.nameTh.trim())}
        className="min-h-11 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white transition duration-200
                   hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "กำลังบันทึก..." : locked ?? "เพิ่มผู้เข้าสอบ"}
      </button>
    </form>
  );
}

export function Field({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputMode?: "numeric";
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink-soft">{label}</span>
      <input
        value={value}
        onChange={onChange}
        inputMode={inputMode}
        className="w-full rounded-lg border border-hairline px-3 py-2 outline-none focus:border-brand"
      />
    </label>
  );
}
