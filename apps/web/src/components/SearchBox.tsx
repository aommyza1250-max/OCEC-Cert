"use client";

import { useState } from "react";
import { MIN_QUERY_LENGTH } from "@/lib/constants";

export function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const tooShort = value.trim().length > 0 && value.trim().length < MIN_QUERY_LENGTH;

  return (
    <form action="/" method="get" className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="พิมพ์ชื่อ-นามสกุล เช่น สมชาย ใจดี หรือ Somchai Jaidee"
          autoComplete="off"
          // ไม่ใส่ autoFocus บนมือถือ คีย์บอร์ดจะเด้งขึ้นมาบังหน้าจอทันที
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base
                     shadow-sm outline-none transition
                     focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
          aria-label="ชื่อ-นามสกุลที่ต้องการค้นหา"
        />
        <button
          type="submit"
          disabled={tooShort}
          className="shrink-0 rounded-xl bg-[var(--color-brand)] px-6 py-3 text-base font-semibold
                     text-white shadow-sm transition hover:brightness-110
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          ค้นหา
        </button>
      </div>
      {tooShort && (
        <p className="mt-2 text-sm text-amber-700">
          กรุณาพิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษร
        </p>
      )}
    </form>
  );
}
