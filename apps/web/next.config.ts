import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone = Docker image เล็กลงมาก เหมาะกับ Railway
  output: "standalone",
  // ปกติ build ลง .next ตามเดิม แต่ตั้ง NEXT_DIST_DIR ให้ build ไปลงที่อื่นได้
  // ไว้ใช้ตอนอยากลอง build/รันทดสอบ **ขณะที่ pnpm dev ยังรันอยู่** โดยไม่เขียนทับ .next
  // ของ dev server (ถ้าเขียนทับ หน้าเว็บจะพังด้วย Cannot find module './vendor-chunks/...')
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // ไฟล์ preview เสิร์ฟจาก R2/CDN ตรง ๆ ไม่ผ่าน Next image optimizer
  // เพื่อไม่ให้ Railway ต้องแบกงานประมวลผลภาพตอนคนเข้าพร้อมกัน 500-600 คน
  images: { unoptimized: true },
};

export default nextConfig;
