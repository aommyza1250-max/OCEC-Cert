"use client";

import { useEffect, useState } from "react";

/** รูปตัวอย่างที่กดแล้วขยายเต็มจอ — บนมือถือ thumbnail เล็กเกินกว่าจะอ่านชื่อได้ */
export function PreviewLightbox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // กันหน้าเว็บด้านหลังเลื่อนตามนิ้วขณะเปิดรูป
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full overflow-hidden rounded-lg border border-gray-200 bg-white"
        aria-label={`ดูรูปตัวอย่างขนาดใหญ่: ${alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="aspect-[842/595] w-full object-cover transition group-hover:scale-[1.02]"
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold"
          >
            ปิด
          </button>
        </div>
      )}
    </>
  );
}
