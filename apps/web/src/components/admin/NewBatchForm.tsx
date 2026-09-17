"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Program } from "./ProgramManager";

/** ปีบนเกียรติบัตรเป็น ค.ศ. ไม่ใช่ พ.ศ. */
const CURRENT_YEAR = new Date().getFullYear();

const ROUNDS = [
  { value: "FINAL", label: "Final (รอบชิงชนะเลิศ)", hint: "ไฟล์รวมทุกประเทศ — ระบบจะตัดเฉพาะหน้าของคนไทย" },
  { value: "HEAT", label: "Heat (รอบคัดเลือก)", hint: "ผู้เข้าสอบเป็นคนไทยทั้งหมด — ตัดแยกทุกหน้า" },
] as const;

export function NewBatchForm({ programs }: { programs: Program[] }) {
  const router = useRouter();
  const active = programs.filter((p) => p.active);
  const [programId, setProgramId] = useState(active[0]?.id ?? "");
  const [round, setRound] = useState<"HEAT" | "FINAL">("FINAL");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = active.find((p) => p.id === programId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ programId, round, year }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) router.push(`/admin/batches/${data.id}`);
    else {
      setError(data.error ?? "สร้างไม่สำเร็จ");
      setBusy(false);
    }
  }

  if (active.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        ยังไม่มีรายการสอบที่เปิดใช้งาน — เพิ่มรายการสอบในส่วนด้านบนก่อน
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">รายการสอบ</span>
          <select
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[var(--color-brand)]"
          >
            {active.map((program) => (
              <option key={program.id} value={program.id}>
                {program.code} — {program.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">รอบการสอบ</span>
          <select
            value={round}
            onChange={(e) => setRound(e.target.value as "HEAT" | "FINAL")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[var(--color-brand)]"
          >
            {ROUNDS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">ปี (ค.ศ.)</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[var(--color-brand)]"
          />
        </label>
      </div>

      {selected && (
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
          {ROUNDS.find((r) => r.value === round)?.hint}
          <br />
          ไฟล์ที่ได้จะชื่อ{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-xs">
            SOMCHAI_JAIDEE_{selected.code}_{round}_GOLD_{year}.pdf
          </code>
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy || !programId}
        className="rounded-lg bg-[var(--color-brand)] px-5 py-2.5 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "กำลังสร้าง..." : "สร้างรอบการนำเข้า"}
      </button>
    </form>
  );
}
