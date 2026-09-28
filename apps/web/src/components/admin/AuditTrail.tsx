import * as React from "react";
import { AUDIT_LABELS } from "@/lib/audit";
import { visibleAuditChanges } from "@/lib/audit-display";

export type AuditRow = {
  id: string;
  action: string;
  createdAt: string;
  before: unknown;
  after: unknown;
  subject?: string | null;
};

/** ประวัติที่อ่านได้เฉพาะแอดมิน — ไม่แสดง UUID, storage key, job payload หรือ session id */
export function AuditTrail({
  events,
  empty = "ยังไม่มีการแก้ไข",
  programCode,
}: {
  events: AuditRow[];
  empty?: string;
  programCode?: string;
}) {
  if (events.length === 0) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const changes = visibleAuditChanges(event.before, event.after, programCode);
        return (
          <li key={event.id} className="rounded-xl border border-hairline bg-card px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <p className="font-medium">{AUDIT_LABELS[event.action] ?? "การแก้ไขข้อมูล"}</p>
                {event.subject && <p className="text-ink-soft">{event.subject}</p>}
              </div>
              <time className="text-ink-soft" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })}
              </time>
            </div>
            {changes.length > 0 && (
              <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-hairline pt-2 text-ink-soft sm:grid-cols-[minmax(9rem,auto)_1fr]">
                {changes.map(({ label, before, after }) => (
                  <div key={label} className="contents">
                    <dt>{label}</dt>
                    <dd className="min-w-0 break-words">
                      {before !== undefined && <span className={after !== undefined ? "line-through" : "text-ink"}>{before}</span>}
                      {before !== undefined && after !== undefined && " → "}
                      {after !== undefined && <span className="text-ink">{after}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}
