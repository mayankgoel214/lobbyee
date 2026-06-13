-- Phase 5 M4: per-workspace voice training flag.
--
-- Gates the in-app voice UI. Default false so voice is dark for every existing
-- and new workspace until explicitly switched on (and a worker host exists).
-- Additive + NOT NULL with a default, so existing rows backfill to false with
-- no rewrite concern at this table size. Read-only to clients: the existing
-- workspace UPDATE grant is already tightened to (name, industry) [migration 4],
-- so authenticated users cannot flip this — it's service-path / SQL only for now.

ALTER TABLE "workspace"
  ADD COLUMN "voice_enabled" BOOLEAN NOT NULL DEFAULT false;
