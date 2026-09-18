"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button
      onClick={logout}
      disabled={busy}
      className="min-h-10 cursor-pointer rounded-xl border px-3 text-sm transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 border-hairline text-ink-soft hover:bg-paper"
    >
      {busy ? "กำลังออก..." : "ออกจากระบบ"}
    </button>
  );
}
