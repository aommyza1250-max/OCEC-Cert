import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { withBatchMutation } from "@/lib/batch-guard";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { loadEntry, updateEntry } from "@/lib/participants";
import { loadParticipants } from "@/lib/publish";
import { supplementalOnlySnapshot } from "@/lib/publish-rules";

const schema = z.object({ action: z.enum(["APPROVE", "REVOKE"]), version: z.number().int() });

/** แอดมินตรวจว่าฮ่องกงส่งมาเพียงใบรางวัลเสริมชุดนี้จริง ๆ ไม่เดาว่าต้องมีใบหลัก */
export const POST = adminHandler<{ entryId: string }>(async (request, { params, session }) => {
  const input = await parseBody(request, schema);
  const found = await prisma.rosterEntry.findUnique({
    where: { id: params.entryId }, select: { batchId: true },
  });
  if (!found) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนนี้ในรายชื่อ");

  await withBatchMutation(found.batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId, input.version);
    if (input.action === "REVOKE") {
      if (!entry.supplementalOnlySnapshot) throw new HttpError(409, "ยังไม่มีการยืนยันให้ยกเลิก");
      await updateEntry(tx, entry, { supplementalOnlySnapshot: null, supplementalOnlyApprovedAt: null });
      await recordAudit(tx, batch, {
        entityType: "ROSTER_ENTRY", entityId: entry.id, action: "SUPPLEMENTAL_ONLY_REVOKED",
        before: { approved: true }, after: { approved: false }, sessionId: session.sessionId,
      });
      return;
    }

    const person = (await loadParticipants(tx, batch)).find((p) => p.entryId === entry.id);
    const snapshot = person ? supplementalOnlySnapshot(person.certificates) : null;
    if (!person || !snapshot) {
      throw new HttpError(409, "ยืนยันได้เฉพาะผู้เข้าสอบที่มีใบรางวัลเสริม แต่ยังไม่มีใบรางวัลหลัก");
    }
    if (person.issues.length > 0) {
      throw new HttpError(409, "ยังมีปัญหาหน้าเกียรติบัตรที่ต้องตัดสินก่อนยืนยันรางวัลเสริม");
    }
    const unmatched = await tx.stagingPage.findMany({
      where: { batchId: batch.id, matchStatus: "UNMATCHED" },
      select: { rosterEntryId: true, certNo: true, review: true },
    });
    if (unmatched.some((page) => {
      const candidates = (page.review as { candidateEntryIds?: unknown } | null)?.candidateEntryIds;
      return page.rosterEntryId === entry.id || page.certNo === entry.candidateNo ||
        (Array.isArray(candidates) && candidates.includes(entry.id));
    })) {
      throw new HttpError(409, "ยังมีหน้าเกียรติบัตรของผู้เข้าสอบคนนี้ที่จับคู่ไม่เสร็จ");
    }
    if (entry.supplementalOnlySnapshot === snapshot) throw new HttpError(409, "ยืนยันไฟล์ชุดนี้ไว้แล้ว");

    await updateEntry(tx, entry, { supplementalOnlySnapshot: snapshot, supplementalOnlyApprovedAt: new Date() });
    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY", entityId: entry.id, action: "SUPPLEMENTAL_ONLY_APPROVED",
      before: { approved: false },
      after: { approved: true, awards: person.certificates.map((c) => c.award) },
      sessionId: session.sessionId,
    });
  });

  return NextResponse.json({ ok: true });
});
