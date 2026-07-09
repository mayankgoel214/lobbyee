-- Phase 5 (voice): idempotency key for worker-persisted turns.
--
-- The Pipecat voice worker persists each turn over a lossy network, so a
-- retried write must not double-insert. The worker stamps the USER message
-- that anchors a turn with a unique key; a replay then collides on this index
-- instead of writing the turn a second time, and the endpoint reconciles to a
-- complete turn (see app/api/voice/worker/turn/route.ts).
--
-- Additive + nullable: every existing (text-path) message keeps idempotency_key
-- NULL, and Postgres permits multiple NULLs under a UNIQUE index, so no
-- existing row conflicts and no backfill is needed. The table-level
-- `GRANT SELECT, INSERT ON message TO authenticated` (2_conversation_engine)
-- already covers the new column — the worker writes through the same scoped
-- `authenticated` role as the text path.
--
-- Rollback (manual, if ever needed):
--   DROP INDEX IF EXISTS "message_idempotency_key_key";
--   ALTER TABLE "message" DROP COLUMN IF EXISTS "idempotency_key";

ALTER TABLE "message" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "message_idempotency_key_key" ON "message"("idempotency_key");
