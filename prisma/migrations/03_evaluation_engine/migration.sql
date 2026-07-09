-- CreateEnum
CREATE TYPE "Competency" AS ENUM ('empathy', 'clarity', 'problem_solving', 'professionalism');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('strength', 'missed_opportunity');

-- AlterEnum
ALTER TYPE "PromptKind" ADD VALUE 'evaluator';

-- CreateTable
CREATE TABLE "evaluation" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "evaluator_prompt_version_id" UUID NOT NULL,
    "empathy_score" INTEGER NOT NULL,
    "empathy_summary" TEXT NOT NULL,
    "clarity_score" INTEGER NOT NULL,
    "clarity_summary" TEXT NOT NULL,
    "problem_solving_score" INTEGER NOT NULL,
    "problem_solving_summary" TEXT NOT NULL,
    "professionalism_score" INTEGER NOT NULL,
    "professionalism_summary" TEXT NOT NULL,
    "overall_summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_evidence" (
    "id" BIGSERIAL NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "competency" "Competency" NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "message_id" BIGINT NOT NULL,
    "quote" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "evaluation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_evaluation" (
    "session_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_evaluation_pkey" PRIMARY KEY ("session_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_session_id_key" ON "evaluation"("session_id");

-- CreateIndex
CREATE INDEX "evaluation_workspace_id_created_at_idx" ON "evaluation"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluation_evidence_evaluation_id_idx" ON "evaluation_evidence"("evaluation_id");

-- CreateIndex
CREATE INDEX "evaluation_evidence_message_id_idx" ON "evaluation_evidence"("message_id");

-- CreateIndex
CREATE INDEX "pending_evaluation_next_attempt_at_idx" ON "pending_evaluation"("next_attempt_at");

-- AddForeignKey
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_evaluator_prompt_version_id_fkey" FOREIGN KEY ("evaluator_prompt_version_id") REFERENCES "prompt_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_evaluation" ADD CONSTRAINT "pending_evaluation_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- RLS — evaluation engine tables (docs/architecture.md §6)
-- Same model as 0_init/2_conversation_engine: owner connection = service path;
-- request path runs as `authenticated` with auth.uid() from tx-local claims.
--
-- Write model: evaluations are produced ONLY by the service path (the
-- evaluator worker). Clients can read them where they can read the session —
-- they can never insert, update, or delete coaching results.
-- ============================================================================

ALTER TABLE "evaluation"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evaluation_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_evaluation"  ENABLE ROW LEVEL SECURITY;

-- evaluation: readable wherever the session is readable (trainee sees their
-- own, admins see all in their workspaces). No write policies — service only.
CREATE POLICY evaluation_select ON "evaluation" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "session" s
    WHERE s.id = session_id
      AND (s.user_id = auth.uid() OR app.is_workspace_admin(s.workspace_id))
  ));

-- evaluation_evidence: follows its evaluation's visibility.
CREATE POLICY evaluation_evidence_select ON "evaluation_evidence" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "evaluation" e
    JOIN "session" s ON s.id = e.session_id
    WHERE e.id = evaluation_id
      AND (s.user_id = auth.uid() OR app.is_workspace_admin(s.workspace_id))
  ));

-- pending_evaluation: internal work queue. NO policies and NO grants —
-- invisible to every client role by design. The UI infers "feedback pending"
-- from (session completed AND no evaluation yet), never from this table.

-- Least-privilege grants (default-privilege auto-grants were revoked in
-- 1_revoke_default_grants, so each table opts in explicitly).
GRANT SELECT ON "evaluation", "evaluation_evidence" TO authenticated;
