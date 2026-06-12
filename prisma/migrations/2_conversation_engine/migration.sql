-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('in_progress', 'completed', 'abandoned', 'errored');

-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('voice', 'text');

-- CreateEnum
CREATE TYPE "TurnRole" AS ENUM ('user', 'guest', 'system', 'coach');

-- CreateEnum
CREATE TYPE "PromptKind" AS ENUM ('guest_system', 'mood_update');

-- CreateTable
CREATE TABLE "persona" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "guest_type" TEXT NOT NULL,
    "backstory" TEXT NOT NULL,
    "voice_id" TEXT,
    "baseline_mood" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "title" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "success_criteria" JSONB NOT NULL,
    "is_library" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "prompt_version_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'in_progress',
    "modality" "Modality" NOT NULL DEFAULT 'text',
    "current_mood" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" BIGSERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "role" "TurnRole" NOT NULL,
    "text" TEXT NOT NULL,
    "mood_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_version" (
    "id" UUID NOT NULL,
    "kind" "PromptKind" NOT NULL,
    "version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persona_workspace_id_idx" ON "persona"("workspace_id");

-- CreateIndex
CREATE INDEX "scenario_workspace_id_idx" ON "scenario"("workspace_id");

-- CreateIndex
CREATE INDEX "session_workspace_id_user_id_started_at_idx" ON "session"("workspace_id", "user_id", "started_at");

-- CreateIndex
CREATE INDEX "message_workspace_id_idx" ON "message"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_session_id_turn_index_key" ON "message"("session_id", "turn_index");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_version_kind_version_key" ON "prompt_version"("kind", "version");

-- AddForeignKey
ALTER TABLE "persona" ADD CONSTRAINT "persona_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario" ADD CONSTRAINT "scenario_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RLS — conversation engine tables (docs/architecture.md §3–4)
-- Same model as 0_init: owner connection = admin path; request path runs as
-- `authenticated` with auth.uid() from transaction-local claims.
-- ============================================================================

ALTER TABLE "persona"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scenario"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prompt_version" ENABLE ROW LEVEL SECURITY;

-- persona: every workspace member reads (staff see them in sessions);
-- only admins author them.
CREATE POLICY persona_select ON "persona" FOR SELECT
  USING (workspace_id = ANY (app.current_workspace_ids()));
CREATE POLICY persona_insert ON "persona" FOR INSERT
  WITH CHECK (app.is_workspace_admin(workspace_id));
CREATE POLICY persona_update ON "persona" FOR UPDATE
  USING (app.is_workspace_admin(workspace_id))
  WITH CHECK (app.is_workspace_admin(workspace_id));
CREATE POLICY persona_delete ON "persona" FOR DELETE
  USING (app.is_workspace_admin(workspace_id));

-- scenario: library rows (workspace_id NULL) readable by everyone signed in;
-- workspace rows by members. Authoring is admin-only; library rows are
-- service-path-only (no workspace admin matches NULL).
CREATE POLICY scenario_select ON "scenario" FOR SELECT
  USING (workspace_id IS NULL OR workspace_id = ANY (app.current_workspace_ids()));
CREATE POLICY scenario_insert ON "scenario" FOR INSERT
  WITH CHECK (workspace_id IS NOT NULL AND app.is_workspace_admin(workspace_id));
CREATE POLICY scenario_update ON "scenario" FOR UPDATE
  USING (workspace_id IS NOT NULL AND app.is_workspace_admin(workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND app.is_workspace_admin(workspace_id));
CREATE POLICY scenario_delete ON "scenario" FOR DELETE
  USING (workspace_id IS NOT NULL AND app.is_workspace_admin(workspace_id));

-- session: trainees see their own; admins see all in their workspaces.
-- Any active member starts their OWN session; only the owner updates it
-- (status transitions), with identity columns frozen by the guard trigger.
CREATE POLICY session_select ON "session" FOR SELECT
  USING (user_id = auth.uid() OR app.is_workspace_admin(workspace_id));
CREATE POLICY session_insert ON "session" FOR INSERT
  WITH CHECK (user_id = auth.uid() AND workspace_id = ANY (app.current_workspace_ids()));
CREATE POLICY session_update ON "session" FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- message: readable wherever the session is readable; INSERT only into your
-- own in-progress session. No UPDATE/DELETE policies or grants — transcripts
-- are immutable by design.
CREATE POLICY message_select ON "message" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "session" s
    WHERE s.id = session_id
      AND (s.user_id = auth.uid() OR app.is_workspace_admin(s.workspace_id))
  ));
CREATE POLICY message_insert ON "message" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "session" s
    WHERE s.id = session_id
      AND s.user_id = auth.uid()
      AND s.status = 'in_progress'
      AND s.workspace_id = "message".workspace_id
  ));

-- prompt_version: global registry, readable by all signed-in users;
-- written by the service path only.
CREATE POLICY prompt_version_select ON "prompt_version" FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Guard trigger: a session's identity columns never change after creation.
CREATE OR REPLACE FUNCTION app.guard_session_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claims text := current_setting('request.jwt.claims', true);
BEGIN
  IF claims IS NULL OR claims = '' THEN
    RETURN NEW; -- service path
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.persona_id IS DISTINCT FROM OLD.persona_id
     OR NEW.scenario_id IS DISTINCT FROM OLD.scenario_id
     OR NEW.prompt_version_id IS DISTINCT FROM OLD.prompt_version_id THEN
    RAISE EXCEPTION 'session identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_session_update
  BEFORE UPDATE ON "session"
  FOR EACH ROW EXECUTE FUNCTION app.guard_session_update();

-- Least-privilege grants (Supabase default-privilege auto-grants were
-- disabled in 1_revoke_default_grants, so each table opts in explicitly).
GRANT SELECT, INSERT, UPDATE, DELETE ON "persona", "scenario" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "session" TO authenticated;
GRANT SELECT, INSERT ON "message" TO authenticated;
GRANT SELECT ON "prompt_version" TO authenticated;
-- message.id is a sequence — INSERT needs it.
GRANT USAGE, SELECT ON SEQUENCE "message_id_seq" TO authenticated;

-- ============================================================================
-- Seed: library scenarios (workspace_id NULL → readable by every workspace)
-- ============================================================================
INSERT INTO "scenario" (id, workspace_id, title, situation, difficulty, success_criteria, is_library) VALUES
(gen_random_uuid(), NULL, 'Disputed minibar charge',
 'The guest has just checked out. There''s a $40 minibar charge on their folio they insist they didn''t make. They''re polite but firm — and pressed for time.',
 3,
 '["Acknowledge the frustration before explaining anything","Walk through the charges line by line, together","Offer a concrete resolution before being asked"]',
 true),
(gen_random_uuid(), NULL, 'Late check-in, room not ready',
 'It''s 11pm. The guest pre-paid and confirmed a late arrival, but their room type is oversold and housekeeping needs 45 more minutes for the alternative.',
 2,
 '["Apologize once, sincerely, without over-explaining","Offer something concrete for the wait (drink, luggage hold, upgrade)","Give a realistic time estimate and follow through"]',
 true),
(gen_random_uuid(), NULL, 'VIP early check-in, full house',
 'A top-tier loyalty guest arrives at 9am wanting immediate check-in. The hotel is at 100% occupancy and nothing is clean yet. They mention their status twice.',
 4,
 '["Acknowledge their status and loyalty explicitly","Never say a bare no — pair every constraint with an alternative","Set a specific commitment and a way to reach you"]',
 true);
