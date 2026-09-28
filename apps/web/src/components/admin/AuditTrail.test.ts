import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AuditTrail } from "./AuditTrail";

it("renders useful audit details without showing internal ids or session codes", () => {
  const html = renderToStaticMarkup(createElement(AuditTrail, {
    events: [{
      id: "event-id-hidden",
      action: "ROSTER_ENTRY_UPDATED",
      createdAt: "2026-09-28T06:00:00.000Z",
      before: { candidateNo: "9001", examMode: "ONLINE", rosterEntryId: "entry-id-hidden" },
      after: { candidateNo: "9001", examMode: "ONSITE", jobId: "job-id-hidden" },
      subject: "เลข 9001",
    }],
  }));
  expect(html).toContain("เลข 9001");
  expect(html).toContain("Online");
  expect(html).toContain("Onsite");
  expect(html).not.toMatch(/entry-id-hidden|job-id-hidden|session|rosterEntryId/);
});
