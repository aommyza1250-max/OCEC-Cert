import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ค้นหาเกียรติบัตร | OCEC",
  description: "ค้นหาและดาวน์โหลดเกียรติบัตรการสอบออนไลน์ด้วยชื่อ-นามสกุล",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
