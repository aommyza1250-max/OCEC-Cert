"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type Program = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  examCount: number;
};

/**
 * จัดการรายการสอบ (HKIMO, TIMO, ...) — รหัสที่ตั้งตรงนี้คือสิ่งที่ไปต่อท้ายชื่อไฟล์
 * {FNAME}_{LNAME}_{รหัส}.pdf ซึ่งเดิมมาจากชื่อโฟลเดอร์ที่เก็บเกียรติบัตร
 */
export function ProgramManager({ programs }: { programs: Program[] }) {
  const [open, setOpen] = useState(programs.length === 0);

  return (
    <section className="rounded-2xl border border-hairline bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">รายการสอบ ({programs.length})</h2>
          <p className="text-sm text-ink-soft">
            รหัสที่ตั้งไว้จะไปอยู่ในชื่อไฟล์ เช่น{" "}
            <code className="rounded bg-paper px-1.5 py-0.5 text-xs">
              SOMCHAI_JAIDEE_{programs[0]?.code ?? "HKIMO"}_FINAL_GOLD_2026.pdf
            </code>
            <br />
            รายการสอบเดียวจัดได้ทั้งรอบ Heat และ Final — เลือกรอบตอนสร้างรอบนำเข้า
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-hairline px-3 py-1.5 text-sm transition hover:bg-paper"
        >
          {open ? "ซ่อน" : "จัดการ"}
        </button>
      </div>

      {open && (
        <div className="mt-5 space-y-5">
          {programs.length > 0 && (
            <ul className="divide-y divide-hairline">
              {programs.map((program) => (
                <ProgramRow key={program.id} program={program} />
              ))}
            </ul>
          )}
          <NewProgramForm />
        </div>
      )}
    </section>
  );
}

function ProgramRow({ program }: { program: Program }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "PATCH" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/programs/${program.id}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({}))).error ?? "ทำรายการไม่สำเร็จ");
    setBusy(false);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <code
        className={`rounded px-2 py-1 text-sm font-bold ${
          program.active ? "bg-brand-soft text-brand" : "bg-paper text-ink-soft"
        }`}
      >
        {program.code}
      </code>
      <span className={`min-w-0 flex-1 truncate text-sm ${program.active ? "" : "text-ink-soft"}`}>
        {program.name}
      </span>
      <span className="text-xs text-ink-soft">ใช้แล้ว {program.examCount} รอบ</span>

      <button
        onClick={() => send("PATCH", { active: !program.active })}
        disabled={busy}
        className="rounded border border-hairline px-2.5 py-1 text-xs transition hover:bg-paper disabled:opacity-40"
      >
        {program.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
      </button>

      {program.examCount === 0 && (
        <button
          onClick={() => {
            if (confirm(`ลบรายการสอบ ${program.code} ?`)) send("DELETE");
          }}
          disabled={busy}
          className="rounded border border-danger-line px-2.5 py-1 text-xs text-danger-ink transition hover:bg-danger-bg disabled:opacity-40"
        >
          ลบ
        </button>
      )}

      {error && <p className="w-full text-sm text-danger-ink">{error}</p>}
    </li>
  );
}

function NewProgramForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/programs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
    });

    if (res.ok) {
      setCode("");
      setName("");
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "เพิ่มไม่สำเร็จ");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-paper p-4">
      <p className="mb-3 text-sm font-medium">เพิ่มรายการสอบใหม่</p>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="รหัส เช่น HKIMO"
          className="rounded-lg border border-hairline px-3 py-2 text-sm font-mono outline-none focus:border-brand"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อเต็ม เช่น Hong Kong International Mathematical Olympiad"
          className="rounded-lg border border-hairline px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      {error && <p className="mt-2 text-sm text-danger-ink">{error}</p>}

      <button
        type="submit"
        disabled={busy || !code.trim() || !name.trim()}
        className="mt-3 min-h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white transition duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 bg-brand hover:bg-brand-dark"
      >
        {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการสอบ"}
      </button>
    </form>
  );
}
