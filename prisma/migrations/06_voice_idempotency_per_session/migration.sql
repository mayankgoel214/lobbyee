-- Phase 5 (voice) hardening: scope the turn idempotency key PER SESSION.
--
-- Migration 5 made idempotency_key globally unique. That let a key collision
-- across tenants (a worker bug, or an astronomically-unlikely UUID clash) brick
-- an unrelated session with an unresolvable 409 — the colliding row lives in
-- another tenant and is invisible under RLS, so the worker could never
-- reconcile it. Scoping uniqueness to (session_id, idempotency_key) makes
-- collisions across sessions impossible by construction and removes that branch
-- entirely. The key still anchors one turn within its own session.
--
-- Safe: idempotency_key is still all-NULL in every row (no voice turn has been
-- written yet), and Postgres treats each NULL as distinct under a UNIQUE index,
-- so neither the drop nor the new index can conflict with existing data.
--
-- Rollback (manual, if ever needed):
--   DROP INDEX IF EXISTS "message_session_id_idempotency_key_key";
--   CREATE UNIQUE INDEX "message_idempotency_key_key" ON "message"("idempotency_key");

DROP INDEX IF EXISTS "message_idempotency_key_key";

CREATE UNIQUE INDEX "message_session_id_idempotency_key_key"
  ON "message"("session_id", "idempotency_key");
