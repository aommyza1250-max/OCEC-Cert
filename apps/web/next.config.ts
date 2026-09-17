import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone = Docker image เล็กลงมาก เหมาะกับ Railway
  output: "standalone",
  // ไฟล์ preview เสิร์ฟจาก R2/CDN ตรง ๆ ไม่ผ่าน Next image optimizer
  // เพื่อไม่ให้ Railway ต้องแบกงานประมวลผลภาพตอนคนเข้าพร้อมกัน 500-600 คน
  images: { unoptimized: true },
};

export default nextConfig;
