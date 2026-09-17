"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const nextPath = useSearchParams().get("next") || "/admin";
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
      router.replace(nextPath);
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "เข้าสู่ระบบไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-brand)]">เข้าสู่ระบบผู้ดูแล</h1>
        <p className="mt-1 text-sm text-gray-500">สำหรับเจ้าหน้าที่นำเข้าเกียรติบัตรเท่านั้น</p>
      </div>

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="รหัสผ่าน"
        autoComplete="current-password"
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none
                   focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-3 font-semibold text-white
                   disabled:opacity-40"
      >
        {busy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
