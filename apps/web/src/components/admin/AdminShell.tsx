import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

/**
 * โครงหน้าของฝั่งหลังบ้าน — ใช้ธีมเดียวกับหน้าค้นหาของผู้ปกครองทุกอย่าง
 *
 * ใช้ธีมเดียวกันเพราะเป็นระบบเดียวกัน คนที่ดูแลระบบก็คือคนที่ตอบคำถามผู้ปกครอง
 * ถ้าสองฝั่งหน้าตาคนละแบบ เวลาคุยกันจะอ้างอิงกันไม่ถูกว่าปุ่มไหนคือปุ่มไหน
 *
 * ต่างกันแค่ความหนาแน่น: ฝั่งนี้วางข้อมูลถี่กว่าเพราะคนใช้คือเจ้าหน้าที่ที่ทำงานซ้ำ ๆ
 * ไม่ใช่ผู้ปกครองที่เข้ามาครั้งเดียว
 */
export function AdminShell({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description?: string;
  /** ลิงก์ย้อนกลับ (หน้ารายละเอียดรอบนำเข้าใช้) */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b border-hairline bg-card">
        {/* แถบสามสีเดียวกับหน้าค้นหา — ตราสัญลักษณ์ของระบบ ไม่ใช่ของหน้าใดหน้าหนึ่ง */}
        <div className="flex h-1.5">
          <div className="flex-1 bg-brand" />
          <div className="flex-1 bg-flag-red" />
          <div className="flex-1 bg-flag-yellow" />
        </div>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/admin"
            className="-mx-2 flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1
                       transition duration-200 hover:bg-brand-soft"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" width={433} height={110} className="h-8 w-auto shrink-0" />
            <span className="h-8 w-px shrink-0 bg-hairline" aria-hidden="true" />
            <span className="font-bold leading-tight text-brand">ระบบหลังบ้าน</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-sm text-ink-soft underline underline-offset-2 hover:text-brand"
            >
              ดูหน้าค้นหา
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
        {back && (
          <Link
            href={back.href}
            className="mb-3 inline-block text-sm text-ink-soft underline underline-offset-2 hover:text-brand"
          >
            ← {back.label}
          </Link>
        )}

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-brand">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
        </header>

        {children}
      </main>
    </>
  );
}
