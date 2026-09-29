-- Additive: existing participants remain unapproved until an admin reviews their supplemental-only certificates.
ALTER TABLE "roster_entries"
  ADD COLUMN "supplemental_only_snapshot" TEXT,
  ADD COLUMN "supplemental_only_approved_at" TIMESTAMP(3);
