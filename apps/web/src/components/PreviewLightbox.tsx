"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, ZoomIcon } from "./icons";

/** รูปตัวอย่างที่กดแล้วขยายเต็มจอ — บนมือถือ thumbnail เล็กเกินกว่าจะอ่านชื่อได้
 *
 *  มีคำว่า "แตะเพื่อดูภาพใหญ่" ติดอยู่บนรูป ไม่ได้รอให้ผู้ใช้เอาเมาส์ไปชี้แล้วค่อยรู้
 *  เพราะบนมือถือไม่มีการ hover และผู้ใช้กลุ่มนี้จะไม่ลองกดอะไรที่ไม่บอกว่ากดได้ */
export function PreviewLightbox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // ย้ายโฟกัสเข้าไปในรูปที่เปิด ไม่งั้นคนใช้คีย์บอร์ดจะยังอยู่หลังฉากดำ
    closeRef.current?.focus();
    // กันหน้าเว็บด้านหลังเลื่อนตามนิ้วขณะเปิดรูป
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  function close() {
    setOpen(false);
    // คืนโฟกัสกลับที่เดิม เพื่อให้กด Tab ต่อจากจุดที่ค้างไว้ได้
    openerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full cursor-pointer overflow-hidden rounded-xl
                   border border-hairline bg-card"
        aria-label={`ดูรูปตัวอย่างขนาดใหญ่: ${alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          // กันหน้าเว็บกระตุกตอนรูปโหลดมา ด้วยการจองพื้นที่ตามสัดส่วนกระดาษ A4 นอน
          className="aspect-[842/595] w-full object-cover"
        />
        <span
          className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5
                     bg-brand-dark/80 py-1 text-xs font-medium text-white sm:py-1.5 sm:text-sm"
        >
          <ZoomIcon className="h-4 w-4" />
          แตะเพื่อดูภาพใหญ่
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="absolute right-4 top-4 flex min-h-12 cursor-pointer items-center gap-2
                       rounded-xl bg-white px-5 text-lg font-semibold text-ink shadow-lg"
          >
            <CloseIcon />
            ปิด
          </button>
        </div>
      )}
    </>
  );
}
