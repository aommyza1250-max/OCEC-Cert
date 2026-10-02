# WebP-only Certificates Implementation Plan

> Update 2026-10-02: Current intake renders one 150 DPI / quality 85 WebP during split and removes the split PDF only after matching and verification. The migration must also find and resize older 180 DPI WebPs that already use quality 85. The original 180 DPI steps below remain as the rollout record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep PDF intake and matching unchanged, then make every matched certificate use one sharp WebP for preview and download and delete its split PDF after verification; provide a temporary admin migration for existing matched certificates.

**Architecture:** The worker retains split PDFs and preliminary previews for unresolved staging pages. After matching commits, a separate idempotent finalizer creates a versioned WebP, switches both database references in one transaction, records old keys for deletion, then deletes the old objects. The same finalizer serves new ZIP intake, individual add/replace, rematches, and a batch migration job. Public delivery reads the WebP key only.

**Tech Stack:** Next.js 15, TypeScript, Prisma/PostgreSQL, Python 3.12, FastAPI worker, PyMuPDF, Pillow, Cloudflare R2/MinIO.

**Spec:** `docs/superpowers/specs/2026-10-01-webp-only-certificates-design.md`

## Global Constraints

- Do not change `normalize` in either language unless both implementations and `shared/normalize-cases.json` are updated together.
- Never commit real certificate PDFs, rosters, or generated WebPs containing personal data.
- Large PDFs and downloads travel directly between browser/worker and R2; never proxy their bytes through Next.js.
- Preserve `AMBIGUOUS` and `DUPLICATE_NAME` manual review; do not infer new people or awards.
- Worker reads large ZIPs from disk, processes one PDF at a time, and creates every Python-inserted UUID with `new_id()`.
- Keep Prisma indexes in `schema.prisma`; after schema change, run `prisma generate` and restart `pnpm dev` before UI verification.
- Render final WebP images at 180 DPI and quality 85. A representative 2105 × 1489 WebP measured 856,098 bytes at quality 90 and 626,690 bytes after re-encoding at quality 85, with small text and signatures remaining clear on inspection. Another PDF sample produced 419 KiB, so expect variation by source artwork.
- Production deletion is performed only by the deployed worker after object verification. No plan or test step deletes production assets.

## File map and interfaces

| Unit | Files | Responsibility |
|---|---|---|
| Schema | `apps/web/prisma/schema.prisma`, new migration | Nullable split-PDF key, `MIGRATE_WEBP` job, durable old-object cleanup rows. |
| Storage/rendering | `apps/worker/app/storage.py`, `tasks/render_preview.py`, `config.py` | Versioned WebP keys, object metadata verification, validated 180-DPI encoding. |
| Finalization | new `apps/worker/app/tasks/finalize_webp.py` | Idempotent matched-page conversion, database switch, cleanup ledger, and old-object deletion. |
| Intake/matching | `tasks/split.py`, `tasks/match.py`, `runner.py` | Preserve current split/match, invoke finalization after committed matching, report conversion failures. |
| Legacy migration | new `tasks/migrate_webp.py`, `runner.py`, new admin API and panel | Dry-run, queue, progress, retry, and blockers for old matched pages. |
| Public/admin web | download route, `CertificateCard.tsx`, `publish.ts`, `publish-rules.ts`, `batch-guard.ts` | WebP-only download and publication gate without altering identity decisions. |
| Lifecycle/docs | `cleanup_sources.py`, `expire.py`, seed, user/runbook docs | Image-aware source cleanup and retention, operator instructions. |
| Follow-up branch | temporary admin panel/API/job and docs | Remove one-time migration controls only after production verification. |

### Task 1: Schema and image storage primitives

**Files:** Modify `apps/web/prisma/schema.prisma`, `apps/worker/app/config.py`, `apps/worker/app/storage.py`, `apps/worker/app/tasks/render_preview.py`; create `apps/web/prisma/migrations/<generated_timestamp>_webp_assets/migration.sql`; test `apps/worker/tests/test_render_preview.py`.

**Interfaces:** Produce `render_webp(page, dpi=180, quality=85) -> bytes`, `final_webp_key(batch_id, page_id, revision) -> str`, and `head_object(key) -> dict`. `revision` is the finalizer job UUID; the returned key is under `previews/<batch>/final/q85/<job>/`. The migration also re-encodes older final WebPs into the current quality-versioned prefix.

- [ ] **Step 1: Write a synthetic one-page PDF test that renders and decodes WebP.**

```python
with pymupdf.open() as doc:
    page = doc.new_page(width=842, height=595)
    page.insert_text((72, 72), "CERTIFICATE 123")
    data = render_webp(page, settings().cert_image_dpi, settings().cert_image_quality)
with Image.open(io.BytesIO(data)) as image:
    assert image.format == "WEBP"
    assert image.width >= 2100 and image.height >= 1480
```

- [ ] **Step 2: Run `cd apps/worker && python -m pytest -q tests/test_render_preview.py`; expect failure because `cert_image_dpi` and `cert_image_quality` are absent.**
- [ ] **Step 3: Add worker settings `cert_image_dpi` from `CERT_IMAGE_DPI=180` and `cert_image_quality` from `CERT_IMAGE_QUALITY=85`; keep the existing low-resolution preliminary preview settings for unresolved pages. Add output format/dimension validation and a `head_object` call using S3 `head_object`.**

```python
def final_webp_key(batch_id: str, page_id: str, revision: str) -> str:
    return f"previews/{batch_id}/{revision}/{page_id}.webp"

def head_object(key: str) -> dict:
    return _client().head_object(Bucket=settings().r2_bucket, Key=key)
```

- [ ] **Step 4: Make `Certificate.pdfKey` nullable; add `MIGRATE_WEBP` to `JobType`; add an `AssetCleanup` model with UUID id, batchId, oldPdfKey?, oldPreviewKey?, createdAt, completedAt?, and an index on `[batchId, completedAt]`. Generate a Prisma migration and client, inspect SQL for `ALTER COLUMN pdf_key DROP NOT NULL`, enum addition and cleanup table; do not hand-add indexes outside the schema.**
- [ ] **Step 5: Run `cd apps/web && pnpm prisma generate && pnpm test` and `cd apps/worker && python -m pytest -q tests/test_render_preview.py`; commit the schema/storage primitive unit.**

### Task 2: Idempotent matched-page finalizer

**Files:** Create `apps/worker/app/tasks/finalize_webp.py`, `apps/worker/tests/test_finalize_webp.py`; modify `apps/worker/app/storage.py` if a single-key delete helper is needed.

**Interfaces:** Produce `finalize_matched_assets(batch_id: str, revision: str, on_progress: ProgressFn, *, dry_run: bool = False) -> dict`, `drain_asset_cleanup(batch_id: str) -> dict`, and `StaleAsset(ValueError)` for a page changed between read and switch. The finalizer selects matched pages with a non-null split-PDF key and a live certificate; it does not alter matching decisions.

- [ ] **Step 1: Add integration tests with synthetic files in MinIO and test DB: successful switch, missing PDF, corrupt PDF, failed upload, failed database transaction, and deletion failure. Assert that a failed conversion retains both old keys and that a retry removes only keys recorded in `AssetCleanup`.**

```python
assert certificate["pdf_key"] is None
assert certificate["preview_key"].startswith(f"previews/{batch_id}/{revision}/")
assert staging_page["preview_key"] == certificate["preview_key"]
assert old_pdf_key not in {o["key"] for o in list_keys(f"certificates/{batch_id}/")}
```

- [ ] **Step 2: Run `docker compose exec worker python -m pytest -q tests/test_finalize_webp.py`; expect failure while the finalizer is absent.**
- [ ] **Step 3: Implement page-at-a-time conversion: download split PDF to temporary disk, render page 0, decode/validate, upload to a new key, HEAD-check object size/content type, then transactionally update `staging_pages` and `certificates` and insert an `AssetCleanup` row holding the old keys. Guard the transaction with the current old `pdf_key` so a concurrent replacement cannot be overwritten.**

```python
updated = conn.execute(
    "UPDATE staging_pages SET pdf_key = NULL, preview_key = %s "
    "WHERE id = %s AND pdf_key = %s RETURNING id",
    (new_key, page_id, old_pdf_key),
).fetchone()
if updated is None:
    raise StaleAsset(page_id)
```

- [ ] **Step 4: After commit, delete only ledger keys under `certificates/<batch>/` and `previews/<batch>/`; mark the cleanup row complete only after successful R2 deletion. On rerun, drain pending rows first and skip rows already `pdf_key IS NULL`. Never delete a currently referenced WebP.**
- [ ] **Step 5: Re-run finalizer tests; commit the finalizer and its tests.**

### Task 3: Wire finalization into new intake and individual add/replace

**Files:** Modify `apps/worker/app/tasks/match.py`, `apps/worker/app/tasks/split.py`, `apps/worker/app/runner.py`, `apps/worker/app/tasks/cleanup_sources.py`; test `apps/worker/tests/test_intake_flow.py`, `test_match.py`, `test_cleanup_sources.py`.

**Interfaces:** Extend `run_match(batch_id, on_progress, payload=None, *, revision: str | None = None) -> dict`; use `revision or new_id()` for final WebP keys. `run_split` and runner job branches pass their job UUID as `revision`. `run_match` returns current matching stats plus `assetFinalization` counts after its DB transaction commits; `ROSTER_ACTIVATE` also reaches that path. A per-page conversion failure is reported in stats and retains the split PDF; it does not erase valid matching decisions.

- [ ] **Step 1: Add tests for ZIP intake and individual add/replace: matched certificate has WebP and no split PDF; an unmatched/ambiguous page retains split PDF and preliminary preview; failed conversion leaves the new certificate unpublished; a later rematch finalizes the page.**
- [ ] **Step 2: Run the focused worker tests and confirm the new assertions fail.**
- [ ] **Step 3: Call `finalize_matched_assets` only after `run_match` exits its transaction. Pass `revision=job_id` from `run_split` and `runner` MATCH/ROSTER_ACTIVATE branches. Keep `_process_page` and its matching inputs unchanged. Ensure `rollback_job_outputs` never deletes a finalized image referenced by a certificate; conversion failures are returned as stats rather than raised through SPLIT rollback.**

```python
with connection() as conn:
    with conn.transaction():
        stats = _apply(conn, batch, profile.catalog, entries, pages, current, decisions)
stats["assetFinalization"] = finalize_matched_assets(batch_id, revision or new_id(), on_progress)
return stats
```

- [ ] **Step 4: Add a source-cleanup blocker for matched certificates that still have `pdf_key` or lack a verified final WebP; retain all existing publication, roster coverage and unresolved-page blockers.**
- [ ] **Step 5: Run focused intake/match/cleanup tests and `docker compose exec worker python scripts/e2e_demo.py`; commit this integration unit.**

### Task 4: WebP delivery and publication safety

**Files:** Modify `apps/web/src/app/api/certificates/[id]/download/route.ts`, `apps/web/src/components/CertificateCard.tsx`, `apps/web/src/lib/publish.ts`, `apps/web/src/lib/publish-rules.ts`, `apps/web/src/lib/batch-guard.ts`; update corresponding vitest/integration tests and `apps/web/prisma/seed.ts`.

**Interfaces:** Any published download URL returns a presigned GET for `previewKey` as `image/webp` with `.webp` filename. `loadParticipants` and `supplementalOnlySnapshot` use the active image key. New publication excludes or blocks any certificate whose split PDF remains or whose image key is absent. Existing published certificates stay accessible from their current preview during migration.

- [ ] **Step 1: Add tests: default, `format=image`, and legacy `format=pdf` URLs all redirect to WebP; no PDF button remains; a new certificate with pending conversion cannot publish; changing an individual certificate's image invalidates supplemental-only approval.**
- [ ] **Step 2: Run `cd apps/web && pnpm test`; expect failures for the new delivery/publication assertions.**
- [ ] **Step 3: Replace PDF selection in the download route with `certificate.previewKey`; preserve maintenance, rate limit, and unpublished 404 checks. Remove the secondary PDF link from `CertificateCard`. Update the snapshot reference from `pdfKey` to `previewKey` and the publication gate using actual certificate asset state.**

```ts
if (!certificate.previewKey) return NextResponse.json({ error: "ไม่พบไฟล์รูปภาพเกียรติบัตร" }, { status: 404 });
const downloadUrl = await presignedDownloadUrl(certificate.previewKey, filename, "image/webp");
return NextResponse.redirect(downloadUrl, 302);
```

- [ ] **Step 4: Update seed certificates to contain a WebP asset and nullable PDF key. Regenerate Prisma client, restart an active `pnpm dev`, then run vitest, TypeScript check and `pnpm build`; commit the public-delivery unit.**

### Task 5: Temporary legacy migration job and admin control

**Files:** Create `apps/worker/app/tasks/migrate_webp.py`, `apps/web/src/app/api/admin/batches/[id]/migrate-webp/route.ts`, `apps/web/src/components/admin/WebpMigrationPanel.tsx`; modify `apps/worker/app/runner.py`, `apps/web/src/app/admin/batches/[id]/page.tsx`, `apps/web/src/components/admin/BatchWorkflow.tsx`, `apps/web/src/lib/batch-guard.ts`; test new worker and web API/UI tests.

**Interfaces:** `POST /api/admin/batches/:id/migrate-webp` accepts `{dryRun:boolean}` and returns `{jobId}` after admin authentication and a same-batch pending-job check. `MIGRATE_WEBP` uses `finalize_matched_assets` and `drain_asset_cleanup`, reports `{total, done, converted, failed, pendingCleanup, bytesBefore, bytesAfter, unresolved}` in `jobs.progress`. The existing `/api/admin/jobs/:id` supplies polling.

- [ ] **Step 1: Test dry-run without R2/DB mutations; duplicate job rejected with 409; published legacy batch accepted; missing PDF reported, not marked complete; interrupted migration safely resumes.**
- [ ] **Step 2: Run the focused worker and web integration tests to confirm the new route/job do not yet exist.**
- [ ] **Step 3: Implement the runner branch and migration wrapper. It processes only matched live certificates with `pdf_key IS NOT NULL`, excludes expired rows, and lists unresolved staging pages separately. Persist progress every 25 pages and cap sample failure details in the admin response; retain full diagnostics in worker logs without exposing personal data in the UI.**

```python
elif job_type == "MIGRATE_WEBP":
    stats = run_migrate_webp(batch_id, job_id, on_progress, payload)
```

- [ ] **Step 4: Implement the admin route with `adminHandler`, batch row lock and no active conflicting job. Add a panel with dry-run, start/retry, progress counts and failure summary. Label it “ย้ายรูปเก่าเป็น WebP คุณภาพปัจจุบัน”, never “รีเซ็ตข้อมูล”, because no certificate records are reset.**
- [ ] **Step 5: Run focused tests and an end-to-end migration on synthetic dev data, then commit the temporary migration unit.**

### Task 6: Retention, approval migration, and operator docs

**Files:** Modify `apps/worker/app/tasks/expire.py`, `apps/worker/app/tasks/delete_batch.py`, `apps/worker/app/tasks/cleanup_sources.py`, `apps/worker/app/tasks/finalize_webp.py`, `apps/web/src/lib/publish.ts`, `apps/web/src/lib/publish-rules.ts`, `docs/admin-guide.md`, `docs/architecture.md`, `docs/data-intake-spec.md`, `docs/db-schema.md`, `docs/runbook.md`, `README.md`; test retention, approval and cleanup integration paths.

**Interfaces:** Expiry deletes the active WebP and any legacy split PDF, sets `filesDeletedAt`, and clears both references. A previously approved supplemental-only set remains approved after image migration if certificate IDs and awards did not change; a genuine replacement still requires renewed approval.

- [ ] **Step 1: Add tests for an approved supplemental-only legacy set before/after migration, an actual replacement, two-year expiry, batch deletion and source cleanup; assert no expired certificate is recreated by migration.**
- [ ] **Step 2: Run focused tests and confirm they expose old PDF-key assumptions.**
- [ ] **Step 3: In the finalizer transaction, load all certificates for the roster entry; compute the legacy snapshot from `[id, award, pdf_key]` for the set and compare it with `supplemental_only_snapshot`. Only if it matches, write the new `[id, award, preview_key]` snapshot using the pending replacement image key. Update publication code to use image keys. Adjust expiry and cleanup to tolerate nullable PDF keys and delete only ledger-verified stale assets.**

```python
if old_snapshot == approved_snapshot:
    conn.execute(
        "UPDATE roster_entries SET supplemental_only_snapshot = %s WHERE id = %s",
        (new_snapshot, roster_entry_id),
    )
```

- [ ] **Step 4: Update docs with WebP-only public delivery, unresolved PDF retention, the temporary migration button, dry-run/retry steps, these production verification queries, and the follow-up branch gate.**

```sql
SELECT count(*) FROM certificates WHERE pdf_key IS NOT NULL AND files_deleted_at IS NULL;
SELECT count(*) FROM asset_cleanup WHERE completed_at IS NULL;
```
- [ ] **Step 5: Run `cd apps/web && pnpm test && pnpm build`, `docker compose exec worker python -m pytest -q`, and synthetic e2e demo. Review the diff for real personal files, then commit.**

### Task 7: Production rollout gate and removal branch

**Files:** Create branch `codex/webp-certificates-remove-migration` from the completed migration branch; remove `WebpMigrationPanel.tsx`, the temporary API route, `tasks/migrate_webp.py`, `MIGRATE_WEBP` enum dispatch and UI labels; update schema through a forward migration only if safe for old job rows, and adjust docs/tests.

**Interfaces:** The deployed image finalizer remains because future matched pages still need it. Remove only the one-time legacy trigger and worker wrapper after every old matched certificate is migrated and no pending cleanup rows remain.

- [ ] **Step 1: On staging, run dry-run, migration, retry, and verify zero matched legacy rows with non-null `pdf_key`, zero incomplete `AssetCleanup` rows, and successful WebP download for representative certificates. Record counts and object-size totals without personal data.**
- [ ] **Step 2: Deploy the migration branch to production through the owner's normal release process; the owner uses the admin button. Do not run production deletion from a local command. Verify every batch and inspect unresolved-page blockers.**
- [ ] **Step 3: After production reports zero remaining matched legacy PDFs and cleanup backlog, create the removal branch. Test that ongoing new intake and manual add/replace still finalize assets.**
- [ ] **Step 4: Remove the temporary panel, route and migration wrapper. Preserve historical enum values if old `jobs` rows still reference `MIGRATE_WEBP`; remove the enum only when the data is clear and a migration proves it safe. Search the references before deleting.**

```bash
rg -n "MIGRATE_WEBP|WebpMigrationPanel|migrate-webp|run_migrate_webp" apps/web apps/worker docs
```
- [ ] **Step 5: Run focused web/worker tests and builds, commit the removal branch, and keep it undeployed until the production migration gate is documented as passed.**

## Self-review checklist

- [x] Spec coverage: old-data conversion, new intake, manual add/replace, unresolved pages, WebP-only delivery, cleanup, retention, publication, temporary button and removal branch each have a task.
- [x] Search the plan for unfinished instructions and mismatched interfaces after any edits.
- [x] Verify the plan calls for Prisma-generated DDL and restarting any running `pnpm dev` after generation.
