/**
 * จำลองผู้ใช้ค้นหาพร้อมกันช่วงประกาศผล
 *
 * ติดตั้ง k6: brew install k6
 * รัน:      k6 run scripts/loadtest.js
 * ชี้ไปที่อื่น: BASE_URL=https://your-app.up.railway.app k6 run scripts/loadtest.js
 *
 * เกณฑ์ผ่านตั้งไว้ที่ p95 < 500ms และ error < 1% ตามที่ออกแบบระบบไว้
 * ถ้าไม่ผ่าน จุดที่ต้องดูก่อนคือ index trigram บนตาราง students
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// คำค้นหลากหลายแบบ เพื่อไม่ให้ Postgres ตอบจาก cache ของ query เดิมซ้ำ ๆ
const QUERIES = [
  "สมชาย", "สมหญิง", "ปิยะดา", "ณัฐพงษ์", "กมลชนก",
  "somchai", "piyada", "nattapong", "jaidee", "srisuk",
  "ธนกฤต", "อารยา", "ภูวดล", "จิราพร", "วรากร",
];

export const options = {
  stages: [
    { duration: "30s", target: 200 }, // คนเริ่มทยอยเข้ามา
    { duration: "30s", target: 600 }, // ช่วงประกาศผลจริง
    { duration: "60s", target: 600 }, // ยืนระยะ
    { duration: "20s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const res = http.get(`${BASE_URL}/?q=${encodeURIComponent(q)}`);

  check(res, {
    "ตอบ 200": (r) => r.status === 200,
    "ได้หน้าเว็บจริง": (r) => r.body.includes("ค้นหาเกียรติบัตร"),
  });

  // คนจริงอ่านผลสักพักก่อนค้นใหม่
  sleep(Math.random() * 3 + 1);
}
