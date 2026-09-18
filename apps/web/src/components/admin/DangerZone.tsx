"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * ลบรอบการนำเข้าทั้งรอบ
 *
 * ปุ่มนี้ลบของจริงและย้อนกลับไม่ได้ ถ้ารอบนั้นเผยแพร่อยู่ ผู้ปกครองจะค้นไม่เจอทันที
 * จึงตั้งใจทำให้ "กดพลาดไม่ได้" ด้วยการบังคับพิมพ์ชื่อรอบยืนยัน
 * กล่องเตือนแบบกด "ตกลง" ผ่านได้ในหนึ่งวินาที ไม่ช่วยอะไรกับงานแบบนี้
 */
export function DangerZone({
  batchId,
  confirmPhrase,
  published,
  counts,
  siblingBatches,
}: {
  batchId: string;
  confirmPhrase: string;
  published: boolean;
  counts: { certificates: number; pages: number; students: number };
  /** จำนวนรอบนำเข้าอื่นของรอบการสอบเดียวกันที่จะยังเหลืออยู่หลังลบอันนี้ */
  siblingBatches: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = typed.trim().toUpperCase() === confirmPhrase && (!published || understood);

  async function remove() {
    setError(null);
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/batches/${batchId}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "ลบไม่สำเร็จ");
      const { jobId } = await res.json();
      await waitUntilGone(jobId);
      router.push("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      setWorking(false);
    }
  }

  return (
    <section className="mt-10 rounded-xl border-2 border-danger-line bg-danger-bg p-4">
      <h2 className="font-semibold text-danger-ink">โซนอันตราย</h2>

      {!open ? (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            ลบรอบการนำเข้านี้ทั้งรอบ ทั้งไฟล์เกียรติบัตร รูปตัวอย่าง และข้อมูลที่จับคู่ไว้
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 cursor-pointer rounded-lg border border-danger-line px-4 py-2 text-sm
                       font-medium text-danger-ink transition hover:bg-danger-bg"
          >
            ลบรอบการนำเข้านี้
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded-lg bg-card px-4 py-3">
            <p className="font-medium text-ink">สิ่งที่จะหายไป</p>
            <ul className="mt-1 list-inside list-disc text-ink-soft">
              <li>เกียรติบัตร {counts.certificates} ใบ พร้อมไฟล์ PDF และรูปตัวอย่างบนคลาวด์</li>
              <li>หน้าที่ตัดไว้ {counts.pages} หน้า และไฟล์ต้นฉบับทั้งหมดของรอบนี้</li>
              <li>
                ผู้เข้าสอบ {counts.students} คนที่จะไม่เหลือเกียรติบัตรในระบบเลย
                (คนที่ยังมีใบจากรอบอื่นจะไม่ถูกลบ)
              </li>
            </ul>
            {siblingBatches > 0 && (
              <p className="mt-2 rounded bg-warn-bg px-3 py-2 text-warn-ink">
                รอบการสอบนี้ยังมีรอบนำเข้าอื่นอีก {siblingBatches} รอบ
                ลบอันนี้แล้วเกียรติบัตรจากอีกรอบยังอยู่ ผู้ปกครองจะยังค้นเจอของรอบนั้น
              </p>
            )}
          </div>

          {published && (
            <label className="flex items-start gap-2 text-ink">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-1 h-4 w-4 cursor-pointer"
              />
              <span>
                รอบนี้<b>เผยแพร่อยู่</b> เข้าใจว่าผู้ปกครองจะค้นหาเกียรติบัตรของรอบนี้ไม่เจอทันที
              </span>
            </label>
          )}

          <div>
            <label htmlFor="confirm" className="block text-ink">
              พิมพ์ <b className="select-all font-mono">{confirmPhrase}</b> เพื่อยืนยัน
            </label>
            <input
              id="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full max-w-sm rounded-lg border border-hairline px-3 py-2 font-mono"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={!ready || working}
              className="min-h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white transition duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 bg-danger-ink hover:brightness-95"
            >
              {working ? "กำลังลบ..." : "ลบถาวร"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setUnderstood(false);
              }}
              disabled={working}
              className="min-h-10 cursor-pointer rounded-xl border px-3 text-sm transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 border-hairline bg-card hover:bg-paper"
            >
              ยกเลิก
            </button>
          </div>

          {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-danger-ink">{error}</p>}
        </div>
      )}
    </section>
  );
}

/** รอจนกว่างานลบจะจบ
 *
 *  งานลบจะลบแถวของตัวเองไปด้วย (jobs ผูกกับ batch แบบ cascade)
 *  การที่ถามแล้วได้ 404 จึงแปลว่า "ลบสำเร็จ" ไม่ใช่ความผิดพลาด
 */
async function waitUntilGone(jobId: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`/api/admin/jobs/${jobId}`);
    if (res.status === 404) return;
    if (!res.ok) continue;

    const job = await res.json();
    if (job.status === "FAILED") throw new Error(job.error ?? "ลบไม่สำเร็จ");
  }
  throw new Error("ใช้เวลานานผิดปกติ ลองรีเฟรชหน้าเพื่อดูผลอีกครั้ง");
}
