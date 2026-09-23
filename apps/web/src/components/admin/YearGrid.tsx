"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "./StatusBadge";

export type GridCell = {
  batchId: string | null;
  /** โปรไฟล์ของรายการ/รอบนี้ — ว่าง = ระบบยังอ่านเกียรติบัตรแบบนี้ไม่ได้ */
  profileKey: string | null;
  status: string | null;
  certificates: number;
  /** รอบนำเข้าอื่นของรอบการสอบเดียวกัน (ปกติเป็น 0) */
  extras: number;
};

export type GridRow = {
  programId: string;
  code: string;
  name: string;
  cells: Record<"HEAT" | "FINAL", GridCell>;
};

const ROUNDS = [
  { key: "HEAT" as const, label: "รอบคัดเลือก" },
  { key: "FINAL" as const, label: "รอบชิงชนะเลิศ" },
];

/**
 * ตารางรอบการนำเข้าของปีหนึ่ง — รายการสอบเป็นแถว รอบเป็นคอลัมน์
 *
 * ทำไมเป็นตารางไม่ใช่รายการยาว: ปีหนึ่งมี 5 รายการสอบ × 2 รอบ = 10 ช่องเสมอ
 * ตารางจึงมีขนาดคงที่ตลอดไป ไม่ว่าระบบจะใช้มากี่ปี และกวาดตาครั้งเดียวรู้ว่าเหลืออะไร
 * ส่วนรายการยาวจะโตปีละ 10 แถวจนต้องไถหา
 *
 * กดช่องว่าง = สร้างรอบนำเข้าแล้วเข้าไปเลย ไม่ต้องกรอกฟอร์ม
 * เพราะช่องนั้นรู้อยู่แล้วว่ารายการสอบอะไร รอบไหน ปีอะไร
 */
export function YearGrid({ year, rows }: { year: number; rows: GridRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(programId: string, round: "HEAT" | "FINAL") {
    setError(null);
    setCreating(`${programId}-${round}`);
    try {
      const res = await fetch("/api/admin/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, round, year }),
      });
      const data = await res.json();
      // มีอยู่แล้ว (เช่นเปิดสองแท็บแล้วกดพร้อมกัน) — พาไปที่รอบเดิม ดีกว่าขึ้น error ให้งง
      if (res.status === 409 && data.existingBatchId) {
        router.push(`/admin/batches/${data.existingBatchId}`);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "สร้างรอบการนำเข้าไม่สำเร็จ");
      router.push(`/admin/batches/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้างรอบการนำเข้าไม่สำเร็จ");
      setCreating(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-hairline bg-card px-5 py-8 text-center text-ink-soft">
        ยังไม่มีรายการสอบ เพิ่มรายการสอบก่อนจึงจะสร้างรอบการนำเข้าได้
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline bg-paper text-sm text-ink-soft">
            <th className="px-4 py-2 font-medium">รายการสอบ</th>
            {ROUNDS.map((round) => (
              <th key={round.key} className="px-4 py-2 font-medium">
                {round.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.programId} className="border-b border-hairline last:border-0">
              <th scope="row" className="px-4 py-3 align-top font-medium">
                <code className="rounded bg-brand-soft px-1.5 py-0.5 text-sm text-brand">
                  {row.code}
                </code>
                <span className="mt-1 block text-xs font-normal text-ink-soft">{row.name}</span>
              </th>
              {ROUNDS.map((round) => {
                const cell = row.cells[round.key];
                const busy = creating === `${row.programId}-${round.key}`;

                if (!cell.batchId && !cell.profileKey) {
                  return (
                    <td key={round.key} className="px-4 py-3 align-top">
                      <span
                        className="block rounded-lg border border-hairline bg-paper px-3 py-2 text-sm text-ink-soft"
                        title="ต้องเพิ่มโปรไฟล์ของรายการนี้ในโค้ดก่อน จึงจะนำเข้าได้"
                      >
                        ยังไม่รองรับ
                      </span>
                    </td>
                  );
                }

                if (!cell.batchId) {
                  return (
                    <td key={round.key} className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => create(row.programId, round.key)}
                        disabled={Boolean(creating)}
                        className="w-full cursor-pointer rounded-lg border border-dashed border-hairline
                                   px-3 py-2 text-sm text-ink-soft transition
                                   hover:border-brand hover:text-brand
                                   disabled:opacity-50"
                      >
                        {busy ? "กำลังสร้าง..." : "+ เริ่มนำเข้า"}
                      </button>
                    </td>
                  );
                }

                return (
                  <td key={round.key} className="px-4 py-3 align-top">
                    <a
                      href={`/admin/batches/${cell.batchId}`}
                      className="block rounded-xl border border-hairline px-3 py-2 transition
                                 duration-200 hover:border-brand hover:bg-brand-soft/40"
                    >
                      <StatusBadge status={cell.status ?? ""} />
                      <span className="mt-1 block text-sm text-ink-soft">
                        {cell.certificates} ใบ
                        {cell.extras > 0 && (
                          <span className="ml-1 text-warn-ink">· อีก {cell.extras} รอบนำเข้า</span>
                        )}
                      </span>
                    </a>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="border-t border-danger-line bg-danger-bg px-4 py-2 text-sm text-danger-ink">{error}</p>}
    </div>
  );
}
