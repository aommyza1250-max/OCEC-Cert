import type { Metadata } from "next";
import { Noto_Sans_Thai_Looped } from "next/font/google";
import "./globals.css";

/** ฟอนต์ไทยแบบ "มีหัว" (looped) — เป็นแบบเดียวกับที่ใช้ในหนังสือเรียนไทย
 *  อ่านง่ายที่สุดสำหรับคนทั่วไป ซึ่งคือผู้ใช้หลักของหน้าค้นหา
 *  โหลดจากเซิร์ฟเวอร์ตัวเอง (next/font จัดการให้) ไม่ต้องยิงไป Google ตอนผู้ใช้เปิดหน้า */
const thai = Noto_Sans_Thai_Looped({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-thai",
});

export const metadata: Metadata = {
  title: "ค้นหาเกียรติบัตร | OCEC",
  description: "ค้นหาและดาวน์โหลดเกียรติบัตรการสอบออนไลน์ด้วยชื่อ-นามสกุล",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={thai.variable}>
      <body className="min-h-dvh font-[family-name:var(--font-thai)] antialiased">{children}</body>
    </html>
  );
}
