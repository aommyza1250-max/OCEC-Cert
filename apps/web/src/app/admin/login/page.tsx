"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InfoIcon, Spinner } from "@/components/icons";

/**
 * หน้าเข้าสู่ระบบของเจ้าหน้าที่ — ธีมเดียวกับหน้าค้นหาของผู้ปกครอง
 *
 * หน้านี้เป็นหน้าเดียวของระบบที่คนนอกอาจเปิดเจอโดยบังเอิญ จึงต้องบอกให้ชัด
 * ว่าเป็นของเจ้าหน้าที่ พร้อมทางกลับไปหน้าค้นหา ไม่ใช่ปล่อยให้ยืนงงหน้าช่องรหัสผ่าน
 */
function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      // อ่านปลายทางตอนกดส่ง ไม่ใช้ useSearchParams เพราะมันบังคับให้ทั้งหน้าต้องอยู่ใน Suspense
      // แล้วผู้ใช้จะเห็นแค่คำว่า "กำลังโหลด..." ก่อนฟอร์มจะโผล่ ซึ่งดูเหมือนเว็บค้าง
      const nextPath = new URLSearchParams(window.location.search).get("next") || "/admin";
      router.replace(nextPath);
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "เข้าสู่ระบบไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-sm">
        {/* แถบสามสีเดียวกับหัวเว็บฝั่งผู้ปกครอง ให้รู้ว่าเป็นระบบเดียวกัน */}
        <div className="flex h-1.5">
          <div className="flex-1 bg-brand" />
          <div className="flex-1 bg-flag-red" />
          <div className="flex-1 bg-flag-yellow" />
        </div>

        <div className="p-5 sm:p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={433} height={110} className="h-9 w-auto" />

          <h1 className="mt-4 text-xl font-bold text-brand">เข้าสู่ระบบผู้ดูแล</h1>
          <p className="mt-1 text-sm text-ink-soft">สำหรับเจ้าหน้าที่นำเข้าเกียรติบัตรเท่านั้น</p>

          <label htmlFor="password" className="mt-5 block font-medium text-ink">
            รหัสผ่าน
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            className="mt-1.5 min-h-12 w-full rounded-xl border-2 border-hairline bg-card px-4
                       text-lg transition focus:border-brand focus:shadow-sm"
          />

          {/* ข้อความผิดพลาดอยู่ติดช่องกรอก ไม่ใช่ลอยอยู่หัวหรือท้ายหน้า */}
          {error && (
            <p
              id="login-error"
              className="mt-2 flex items-start gap-1.5 text-sm font-medium text-danger-ink"
            >
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="mt-4 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2
                       rounded-xl bg-brand px-4 text-lg font-semibold text-white
                       transition duration-200 hover:bg-brand-dark active:scale-[0.99]
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Spinner className="h-5 w-5" />}
            {busy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-sm text-ink-soft">
        ไม่ใช่เจ้าหน้าที่?{" "}
        <Link href="/" className="text-brand underline underline-offset-2">
          ไปหน้าค้นหาเกียรติบัตร
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <LoginForm />
    </main>
  );
}
