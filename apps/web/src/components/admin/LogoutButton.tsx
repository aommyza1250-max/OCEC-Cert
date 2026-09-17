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
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600
                 transition hover:bg-gray-50 disabled:opacity-40"
    >
      {busy ? "กำลังออก..." : "ออกจากระบบ"}
    </button>
  );
}
