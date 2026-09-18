"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MIN_QUERY_LENGTH } from "@/lib/constants";
import { SearchIcon, Spinner } from "./icons";

/** ช่องค้นหาหลักของหน้าสาธารณะ
 *
 *  ออกแบบให้ผู้ปกครองที่ไม่คุ้นเว็บใช้ได้ทันทีโดยไม่ต้องเดา:
 *    - มีป้ายชื่อช่องเขียนอยู่จริง ไม่ใช่ข้อความจาง ๆ ในช่อง (พอพิมพ์แล้วข้อความจางจะหาย
 *      คนที่พิมพ์ช้าจะลืมว่าช่องนี้ให้กรอกอะไร)
 *    - ช่องกรอกและปุ่มสูง 56px กดพลาดยาก และตัวหนังสือใหญ่กว่าปกติ
 *    - ปุ่มมีคำว่า "ค้นหา" ไม่ใช่แว่นขยายเปล่า ๆ
 *    - กดแล้วขึ้น "กำลังค้นหา..." ทันที ไม่ปล่อยให้ยืนงงว่ากดติดหรือยัง
 *
 *  ยังเป็น <form method="get"> จริง ๆ อยู่ กด Enter ได้ และถ้า JS ไม่ทำงานก็ยังค้นได้
 */
export function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [pending, startTransition] = useTransition();
  const [showHint, setShowHint] = useState(false);

  const trimmed = value.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  // ค้นจากชื่ออังกฤษอย่างเดียว พิมพ์ไทยมาก็ไม่มีทางเจอ — บอกทันทีที่พิมพ์
  // ไม่ต้องรอให้กดค้นหาแล้วไปเจอหน้า "ไม่พบ" ซึ่งไม่ได้บอกว่าผิดเพราะภาษา
  const hasThai = /[\u0E00-\u0E7F]/.test(value);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    if (tooShort || trimmed.length === 0) {
      // บอกตรงใต้ช่องกรอก ไม่เด้ง alert และไม่ไปขึ้นรวมที่หัวหน้า
      event.preventDefault();
      setShowHint(true);
      return;
    }
    event.preventDefault();
    startTransition(() => router.push(`/?q=${encodeURIComponent(trimmed)}`));
  }

  return (
    <form action="/" method="get" onSubmit={submit} className="w-full">
      <label htmlFor="q" className="block font-semibold text-ink sm:text-lg">
        พิมพ์ชื่อผู้เข้าสอบเป็นภาษาอังกฤษ
      </label>
      <p id="q-help" className="mt-0.5 text-sm text-ink-soft sm:mt-1 sm:text-base">
        เช่น <span className="font-medium text-ink">SOMCHAI JAIDEE</span> หรือพิมพ์แค่{" "}
        <span className="font-medium text-ink">SOMCHAI</span> ก็ได้
      </p>

      <div className="mt-2.5 flex flex-col gap-2.5 sm:mt-3 sm:flex-row sm:gap-3">
        <input
          id="q"
          type="search"
          name="q"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowHint(false);
          }}
          enterKeyHint="search"
          autoComplete="off"
          aria-describedby="q-help"
          aria-invalid={hasThai || (showHint && tooShort) ? true : undefined}
          // ไม่ใส่ autoFocus บนมือถือ คีย์บอร์ดจะเด้งขึ้นมาบังหน้าจอทันที
          className="min-h-13 w-full rounded-xl border-2 border-hairline bg-card px-4 text-lg
                     shadow-sm transition placeholder:text-ink-soft
                     focus:border-brand focus:shadow-md sm:min-h-14"
          placeholder="ชื่อ นามสกุล"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-13 shrink-0 cursor-pointer items-center justify-center gap-2
                     rounded-xl bg-brand px-8 text-lg font-semibold text-white shadow-sm sm:min-h-14
                     transition duration-200 hover:bg-brand-dark active:scale-[0.99]
                     disabled:cursor-wait disabled:opacity-80"
        >
          {pending ? <Spinner /> : <SearchIcon />}
          {pending ? "กำลังค้นหา..." : "ค้นหา"}
        </button>
      </div>

      {hasThai ? (
        <p className="mt-2 text-sm font-medium text-flag-red sm:text-base">
          ค้นได้เฉพาะชื่อภาษาอังกฤษ กรุณาพิมพ์เป็นภาษาอังกฤษ
        </p>
      ) : (
        showHint &&
        tooShort && (
          <p className="mt-2 text-sm font-medium text-flag-red sm:text-base">
            กรุณาพิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษร
          </p>
        )
      )}
    </form>
  );
}
