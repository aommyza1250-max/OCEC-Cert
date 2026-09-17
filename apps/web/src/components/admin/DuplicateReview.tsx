"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type DuplicatePage = {
  id: string;
  pageNumber: number;
  extractedName: string | null;
  certNo: string | null;
  level: string | null;
  previewUrl: string | null;
  matchNote: string | null;
  /** รางวัลจากชื่อโฟลเดอร์ใน ZIP — แหล่งความจริงของรางวัล */
  award: string | null;
  /** รางวัลตามที่ Excel เขียน — เก็บไว้ให้แอดมินไม่ต้องเปิด Excel ซ้ำ */
  rosterAward: string | null;
  /** true = ใบที่ระบบจับคู่ไปแล้ว, false = ใบที่ชนเข้ามาทีหลัง */
  isMatched: boolean;
  studentNameTh: string | null;
  studentNameEn: string | null;
  studentSchool: string | null;
};

export type DuplicateGroup = {
  name: string;
  pages: DuplicatePage[];
};

/**
 * ชื่อซ้ำกันในรายการสอบเดียวกัน — ระบบไม่เดาให้ว่าเป็นคนเดียวกันหรือคนละคน
 * เพราะสองกรณีนี้ผลลัพธ์ต่างกันมาก แอดมินต้องเห็นเกียรติบัตรจริงทั้งสองใบก่อนตัดสิน
 */
export function DuplicateReview({ groups }: { groups: DuplicateGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-1 font-semibold">ชื่อซ้ำ ต้องตัดสิน ({groups.length} ชื่อ)</h2>
      <p className="mb-4 text-sm text-gray-500">
        พบชื่อเดียวกันมากกว่าหนึ่งใบในรายการสอบนี้ กรุณาเทียบเกียรติบัตรทั้งสองใบ
        แล้วเลือกว่าเป็นคนละคนที่ชื่อเหมือนกัน หรือเป็นใบซ้ำของคนเดียวกัน
      </p>

      <div className="space-y-6">
        {groups.map((group) => (
          <DuplicateGroupCard key={group.name} group={group} />
        ))}
      </div>
    </section>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const duplicates = group.pages.filter((p) => !p.isMatched);
  const [nameTh, setNameTh] = useState("");
  const [school, setSchool] = useState("");

  return (
    <article className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4">
      <header className="mb-4">
        <h3 className="font-bold">{group.name}</h3>
        <p className="text-sm text-gray-600">พบทั้งหมด {group.pages.length} ใบในรายการสอบนี้</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {group.pages.map((page) => (
          <PageCard key={page.id} page={page} />
        ))}
      </div>

      <div className="mt-5 space-y-4 border-t border-amber-200 pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              ชื่อภาษาไทยของคนที่จะแยกออกมา (ไม่บังคับ)
            </span>
            <input
              value={nameTh}
              onChange={(e) => setNameTh(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">โรงเรียน (แนะนำให้กรอก)</span>
            <input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="กรอกไว้แล้วรอบหน้าระบบจะแยกคนชื่อพ้องได้เอง"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
            />
          </label>
        </div>

        {duplicates.map((page) => (
          <DecisionRow key={page.id} page={page} nameTh={nameTh} school={school} />
        ))}
      </div>
    </article>
  );
}

function PageCard({ page }: { page: DuplicatePage }) {
  return (
    <div
      className={`rounded-lg border bg-white p-3 ${
        page.isMatched ? "border-green-300" : "border-amber-300"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">หน้า {page.pageNumber}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            page.isMatched ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
          }`}
        >
          {page.isMatched ? "จับคู่ไปแล้ว" : "รอตัดสิน"}
        </span>
      </div>

      {page.previewUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={page.previewUrl}
          alt={`หน้า ${page.pageNumber}`}
          loading="lazy"
          className="w-full rounded border border-gray-200"
        />
      ) : (
        <div className="flex aspect-[842/595] items-center justify-center rounded bg-gray-100 text-sm text-gray-400">
          ไม่มีรูป
        </div>
      )}

      <dl className="mt-3 space-y-1 text-sm">
        <Row label="ชื่อบนเกียรติบัตร" value={page.extractedName} />
        <Row label="เลขเกียรติบัตร" value={page.certNo} />
        <Row label="ระดับชั้น" value={page.level} />
        <Row label="รางวัล (จากโฟลเดอร์)" value={page.award} />
        <Row label="รางวัล (ตาม Excel)" value={page.rosterAward} />
        {page.isMatched && (
          <>
            <Row label="ผูกกับผู้เข้าสอบ" value={page.studentNameTh ?? page.studentNameEn} />
            <Row label="โรงเรียน" value={page.studentSchool} />
          </>
        )}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-gray-500">{label}:</dt>
      <dd className="min-w-0 font-medium">{value}</dd>
    </div>
  );
}

function DecisionRow({
  page,
  nameTh,
  school,
}: {
  page: DuplicatePage;
  nameTh: string;
  school: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "separate" | "keep" | "discard", confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/admin/pages/${page.id}/resolve-duplicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, nameTh, school }),
    });

    if (res.ok) router.refresh();
    else {
      setError((await res.json().catch(() => ({}))).error ?? "ทำรายการไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg bg-white p-3">
      <p className="mb-3 text-sm">
        หน้า <b>{page.pageNumber}</b>
        {page.certNo && <span className="text-gray-500"> (เลขที่ {page.certNo})</span>} คือ...
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => decide("separate")}
          disabled={busy}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          คนละคน — แยกเป็นผู้เข้าสอบใหม่
        </button>
        <button
          onClick={() =>
            decide("keep", `ใช้หน้า ${page.pageNumber} แทนใบที่จับคู่ไว้เดิม และทิ้งใบเดิม?`)
          }
          disabled={busy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm transition hover:bg-gray-50 disabled:opacity-40"
        >
          ใบซ้ำ — เก็บใบนี้ ทิ้งใบเดิม
        </button>
        <button
          onClick={() => decide("discard", `ทิ้งหน้า ${page.pageNumber} ?`)}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
        >
          ใบซ้ำ — ทิ้งใบนี้
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
