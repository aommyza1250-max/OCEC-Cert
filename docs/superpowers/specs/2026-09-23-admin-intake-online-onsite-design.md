# Admin Intake Flow: Online and Onsite

Date: 2026-09-23

## Summary

Redesign the admin intake flow so the roster becomes the durable source of expected participants before any certificate ZIP is accepted. A single batch contains both online and onsite participants. Each roster entry records exactly one exam mode, while certificate ZIPs may contain both modes or only one.

The redesign also adds a searchable admin editor, safe incremental certificate uploads, explicit issue resolution, partial publishing, and durable audit records. Exam mode is an admin-only field and is never shown on public search or download pages.

This design intentionally does not migrate or backfill the one existing data set. After implementation, the old data will be backed up, cleared in a separate operation, and re-imported through the new flow.

## Goals

- Require a valid combined roster before accepting certificate files.
- Persist every expected participant, including participants whose certificates have not arrived.
- Record whether each participant is `ONLINE` or `ONSITE`.
- Show roster totals for all participants, online participants, and onsite participants.
- Accept combined, online-only, and onsite-only certificate ZIPs.
- Allow repeated ZIP uploads without replacing already accepted certificates.
- Detect and safely resolve certificate/roster mode mismatches.
- Allow admins to add a missing participant manually and preserve manual entries across later roster replacements.
- Allow admins to search and edit participant and certificate data after withdrawing publication.
- Publish valid participants while holding unresolved participants back.
- Preserve enough source and audit data to explain every manual correction.

## Non-goals

- Showing online/onsite mode on public pages.
- Supporting participants who should not receive a certificate. Every active roster entry is expected to have at least one certificate.
- Migrating or backfilling old batches.
- Introducing named admin accounts. The current shared admin authentication cannot identify a human actor reliably; audit events will record the authenticated admin session, timestamp, and change details. Named actors require a separate authentication project.
- Inferring awards from certificate text or the roster. The ZIP award folder remains the primary award source.

## Core invariants

1. A batch represents one exam program, round, and year, and contains both exam modes.
2. Every active roster entry has exactly one mode: `ONLINE` or `ONSITE`.
3. A candidate number is unique across both modes within a batch.
4. One participant may have only one mode within a batch.
5. Every roster entry is expected to have at least one accepted certificate.
6. A participant may have multiple certificates only when their awards differ.
7. The normal duplicate key for a certificate is `(batch, candidate number, award)`.
8. Awards come from the ZIP award folder. A later admin reclassification is an explicit, audited override and never an inference from page text or Excel.
9. The system never guesses when a name, identity, mode, or duplicate is ambiguous.
10. No upload or edit is allowed while a batch is published. An admin must explicitly withdraw publication first.
11. Large files continue to travel directly between the browser and R2. They never pass through the Next.js server.

## Data model

### New enums

`ExamMode`

- `ONLINE`
- `ONSITE`

`RosterSource`

- `EXCEL`
- `MANUAL`

### RosterEntry

`RosterEntry` is the durable participant record for one batch. It is separate from `Student` because exam mode, candidate number, level, and roster source belong to a particular sitting, not to a person across all years.

Required fields:

- `id`
- `batchId`
- `candidateNo`
- `nameEn` and/or `nameTh`, with at least one required
- normalized name fields and English name sort key
- `examMode`
- `source`
- created and updated timestamps

Optional fields:

- `school` and normalized school
- `level`
- raw roster award for cross-checking and missing-file guidance
- source Excel row number
- `studentId`, filled only after identity resolution is safe

Constraints and indexes:

- Unique `(batchId, candidateNo)`.
- Index `(batchId, examMode)` for summaries and filters.
- Normalized-name indexes for admin search and fallback matching.
- An active roster entry cannot have a null exam mode.

### RosterImport and draft rows

A roster replacement must not alter active data until the whole file has passed validation. Store each attempted import as a `RosterImport` and its parsed rows as draft import rows, or an equivalent durable draft representation.

Each Excel upload uses a new versioned R2 key. An invalid draft must never overwrite the source file belonging to the currently active roster import.

The import records:

- R2 source key and upload timestamp.
- Validation state and validation messages.
- total, online, and onsite counts.
- duplicate candidate numbers and invalid source rows.
- conflicts with `MANUAL` roster entries.
- activation timestamp.

Only one roster import is active for a batch. Invalid or unresolved drafts never affect active roster entries.

### StagingPage changes

Add:

- `examMode`, read from the ZIP path.
- nullable `rosterEntryId`.
- a source upload/job identifier so repeated uploads and cleanup are traceable.
- an optional explicit award override while preserving the original folder-derived award.

Extend the review states so the UI can distinguish at least:

- `UNMATCHED`
- `MATCHED`
- `NAME_MISMATCH`
- `MODE_MISMATCH`
- `AMBIGUOUS`
- `DUPLICATE_NAME` or an equivalent duplicate-review state
- `DISCARDED`
- existing foreign-page handling where applicable

The original source path, folder-derived award, and folder-derived mode remain immutable evidence even after a manual correction.

### Certificate changes

Each certificate links to its `RosterEntry`. Multiple certificates may link to one roster entry when awards differ.

The certificate keeps the effective award used publicly. If an admin reclassifies an award, the staging page retains both the original folder award and the override, and the audit log records the transition.

The public search model remains based on `Student`; exam mode is not exposed publicly.

### Audit events

Record security-sensitive admin changes, including:

- manual roster entry creation or deletion
- name, candidate number, mode, school, or level changes
- certificate file replacement
- award reclassification
- mode-mismatch confirmation
- certificate discard or restore
- roster conflict resolution
- publication withdrawal and publication

Each event records batch, entity type and ID, action, before/after values, timestamp, and the available authenticated-session identifier. It must not claim a named human actor while shared-password authentication is in use.

## Admin workflow

### 1. Create an unpublished batch

The existing exam program, round, and year selection remains. A new batch begins unpublished and has no active roster.

### 2. Upload and activate the roster

The roster is a combined online/onsite Excel file. Every data row must contain:

- candidate number
- at least one supported name field
- exam mode

Exam-mode parsing trims surrounding whitespace and ignores case, but accepts only `ONLINE` and `ONSITE` after normalization.

Validation rejects the entire draft when:

- a required column is missing
- a required value is blank
- an exam-mode value is unknown
- a candidate number occurs more than once anywhere in the file
- a row cannot supply a usable name

The validation result lists every actionable row error rather than stopping at the first one.

When a valid draft does not conflict with manual entries, activation replaces all active `EXCEL` roster entries in one database transaction and preserves non-conflicting `MANUAL` entries.

When an incoming row conflicts with a manual entry, activation pauses for admin review. The admin may:

- merge the incoming row into the manual entry, selecting the intended values; or
- keep the manual entry and exclude the conflicting incoming row.

The candidate-number uniqueness constraint must still hold after all resolutions. Only then may the draft activate.

After activation, the system invalidates automatic matching results, retains source evidence, and queues an idempotent rematch. Because the batch is unpublished, no partially recomputed result can become public.

### 3. Show roster summary

After activation, show:

- total participants
- online participants
- onsite participants
- entries from Excel
- entries added manually
- unresolved draft conflicts, if any

The certificate upload step stays disabled until an active roster exists.

### 4. Upload certificate ZIPs

Supported layouts are:

```text
online/{award}/*.pdf
onsite/{award}/*.pdf
```

A ZIP may contain both roots or only one. It may also have one harmless outer wrapper directory:

```text
HKIMO/online/gold/file.pdf
HKIMO/onsite/silver/file.pdf
```

Mac metadata files and other explicitly ignored platform artifacts remain ignored. A PDF may not sit outside the mode and award hierarchy.

Before splitting any page, the worker performs a full structural preflight. The whole ZIP is rejected without changing active data when:

- no supported PDF exists
- a PDF lacks an online/onsite ancestor in the supported position
- a PDF lacks a recognized award folder
- an award folder cannot be normalized
- the hierarchy is otherwise ambiguous

Unknown awards stop the whole job. The system never guesses or silently skips them.

ZIPs are uploaded directly to R2, downloaded by the worker to disk, and processed one contained PDF at a time. The worker must not load the whole ZIP or all contained PDFs into memory.

### 5. Match each certificate page

For each eligible page:

1. Apply the existing round-specific nationality rule: Heat processes every page; Final retains only eligible Thai pages and records skipped foreign pages.
2. Read the certificate/candidate number.
3. Find the active roster entry by candidate number.
4. Verify the certificate name against the roster name.
5. Compare ZIP mode with roster mode.
6. Take the award from the award folder.
7. Create or update a certificate only after the checks pass.

Candidate number is the primary key because it is guaranteed unique across online and onsite participants in a batch.

If the number cannot be read, fallback matching may use normalized name plus exam mode only when that identifies exactly one roster entry. Multiple possible entries become `AMBIGUOUS`; the system does not choose one.

Per-page errors do not stop other valid pages:

- no roster entry or no safe fallback: `UNMATCHED`
- candidate number matches but name does not: `NAME_MISMATCH`
- candidate number and name match but mode differs: `MODE_MISMATCH`
- multiple fallback candidates: `AMBIGUOUS`
- an accepted certificate already owns the effective duplicate key: duplicate review or skip, depending on whether the page is byte-for-byte/source-equivalent

### 6. Incremental ZIP uploads and deduplication

An admin may upload ZIPs repeatedly after the roster exists and while the batch is unpublished.

- An already accepted `(candidate number, award)` is skipped.
- Re-uploading the same unresolved page does not create another issue row.
- A new correctly classified page replaces an earlier `MODE_MISMATCH` page for the same candidate and award, and closes the old issue.
- A page for a candidate not yet in the roster remains in staging. Adding that roster entry later triggers rematching.
- A roster entry without an accepted certificate appears in the missing-file queue.

The duplicate implementation must account for unresolved states. The existence of a bad quarantined page must not cause a later correct page to be skipped.

### 7. Add a missing participant manually

An admin can add a roster entry with:

- unique candidate number
- name
- online/onsite mode
- optional school and level
- optional expected/raw award for follow-up guidance

The entry is marked `MANUAL`. After creation, the system immediately attempts to match compatible staging pages. If none exists, the participant appears in the missing-file queue.

Future Excel replacements preserve manual entries unless the admin explicitly merges or deletes them through conflict resolution.

### 8. Resolve mode mismatch

The review UI shows certificate preview, candidate number, name, roster mode, ZIP mode, award, source ZIP, and source path.

The admin can:

- **Use roster mode:** allowed only when candidate number and name already match. The system records an audited mode override and completes matching.
- **Discard and wait for a new file:** the page remains as discarded evidence and cannot publish.
- **Upload a corrected ZIP/PDF:** a correctly classified replacement supersedes the quarantined page.

Uploading the same mismatch again updates or recognizes the existing issue; it does not create repeated issue cards.

## Searchable admin editor

The admin editor searches by name or candidate number and filters by:

- exam mode
- award
- issue state
- roster source
- certificate presence

The detail view separates participation data from certificate data.

### Participation edits

Admins may edit name, candidate number, mode, school, and level while the batch is unpublished.

- Candidate-number changes must remain unique and trigger rematching.
- Mode changes revalidate every linked staging page and certificate.
- Name changes recompute normalized fields and revalidate certificate names.
- If the linked `Student` has certificates in other exams, the UI warns how many historical records a global student-name edit affects.
- If records were joined to the wrong person, the admin uses a separate-person action instead of renaming the shared `Student`.

### Certificate edits

Admins may:

- replace a PDF and preview
- add a certificate for the selected participant
- discard or restore a certificate
- explicitly reclassify its award

A replacement PDF must pass candidate-number and name checks before becoming active. A multi-page upload selects only the unique matching page; if selection remains ambiguous, it is rejected with a clear instruction to upload a single-page PDF.

Award reclassification is not a free-text edit. It is an explicit action that:

- requires confirmation
- checks that the participant does not already have the target award
- preserves the folder-derived original award
- records the effective override and audit event

## Publication rules

While a batch is published, both the UI and APIs reject:

- roster uploads
- ZIP/PDF uploads
- roster activation
- participant edits
- certificate edits and issue-resolution actions

The admin must explicitly withdraw the batch first. Withdrawal makes all certificates in that batch temporarily unavailable publicly until the next publish action.

Publishing is participant-aware and may be partial:

- Publish only certificates whose roster entry and staging page are fully matched and valid.
- Hold participants with missing files, `NAME_MISMATCH`, `MODE_MISMATCH`, `AMBIGUOUS`, duplicate review, or other unresolved states.
- Keep the existing multi-award policy checks.
- Show the exact number of participants and certificates to publish and the number held back, grouped by reason and mode.

A later correction requires another explicit withdrawal, edit/upload, review, and publish cycle. Publishing again republishes every currently valid certificate and continues holding invalid entries.

## Failure handling and concurrency

- Permit only one mutating import/edit job per batch at a time.
- Enforce the lock in the API/database path, not only by disabling buttons.
- Use optimistic version checks for interactive edits so two browser tabs cannot silently overwrite each other.
- Perform ZIP structural preflight before deleting or replacing active page data.
- Make roster activation and manual edits transactional.
- Make matching idempotent: a retry first removes only prior automatic results that the job owns, while preserving explicit admin decisions unless the active roster change invalidates them.
- When a roster replacement changes identity inputs, previously manual matches return to review rather than being trusted silently.
- Track R2 keys created by a failed job and clean those derived files on rollback/retry. Keep the uploaded source file for diagnosis until normal source cleanup.
- Return file-validation errors as user errors with row, path, or page context. Reserve system-failure messaging for infrastructure or code failures.

## Data reset and re-import

Backward compatibility is deliberately excluded. After the new flow is deployed and verified:

1. Back up the existing database records and source/derived object inventory.
2. Run the data-removal operation separately from schema migration.
3. Confirm the exact batch and object prefixes before deleting anything.
4. Re-import the sole existing data set using a roster that includes valid online/onsite values and ZIPs in the new hierarchy.
5. Compare roster totals, mode totals, certificate totals, held issues, and a sample of public downloads before publishing.

The implementation plan must treat backup, reset, and re-import as an explicit operational phase requiring confirmation. Schema deployment must not erase production data automatically.

## Test strategy

All tests use synthetic fixtures. Real rosters and certificates must never enter the repository.

### Roster tests

- Missing exam-mode column rejects the whole draft.
- Blank or unknown mode reports every bad row.
- Candidate-number duplication across online and onsite rows rejects the draft.
- Header aliases, whitespace, and case normalization behave as specified.
- A failed draft leaves the active roster unchanged.
- Activation replaces Excel entries atomically.
- Manual entries survive replacement.
- Manual-entry conflicts require resolution and preserve uniqueness.
- Summary totals are correct.

### ZIP and matching tests

- Combined, online-only, onsite-only, and one-wrapper ZIP layouts pass.
- Missing mode, missing award, loose PDF, and unknown award reject the whole ZIP before mutation.
- Candidate number, name, and mode agreement produces `MATCHED`.
- Name mismatch and mode mismatch produce distinct states.
- Unique name-plus-mode fallback works when candidate number is unreadable.
- Ambiguous fallback never creates a certificate.
- Multiple awards for one participant work; the same award cannot duplicate.
- Append skips accepted certificates.
- Repeated unresolved uploads do not multiply issues.
- A corrected upload supersedes a mode mismatch.
- Adding a manual roster entry rematches a waiting staging page.
- Missing-file lists include every roster entry with no accepted certificate and separate online/onsite counts.

### Editor and publication tests

- Published batches reject every upload and mutation API.
- Withdrawal enables edits.
- Candidate-number and award uniqueness are enforced during edits.
- Name, mode, award, and file changes create audit events.
- Replacement PDFs must match the intended candidate and name.
- Award reclassification preserves the original award and prevents collisions.
- Partial publish includes only valid entries and reports held reasons accurately.
- Republishing after correction publishes all currently valid entries.

### Resource and cross-language tests

- Large ZIP processing continues to use disk and one-contained-PDF-at-a-time reading.
- Browser uploads continue to use presigned R2 PUTs.
- Any normalization change is implemented in both TypeScript and Python and covered by the shared normalization cases.

## Acceptance criteria

The design is complete when an admin can:

1. Import one combined roster and see correct total, online, and onsite counts.
2. Upload any supported ZIP variant repeatedly without replacing accepted certificates.
3. See and resolve distinct name, mode, ambiguity, duplicate, and missing-file issues.
4. Add a participant omitted from Excel and retain that participant across later Excel replacements.
5. Search and safely edit participant and certificate information while unpublished.
6. Publish all valid participants while holding unresolved participants back.
7. Withdraw publication before any subsequent upload or edit.
8. Trace manual corrections to their prior values, new values, time, and authenticated admin session.
