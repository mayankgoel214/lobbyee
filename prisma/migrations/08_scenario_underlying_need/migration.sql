-- §5 Scenario "depth": the hidden layer that makes a practice guest
-- realistically hard to satisfy.
--
-- Additive and safe:
--   * underlying_need / resolution_path — nullable TEXT, no default, no rewrite.
--   * resolvability — enum NOT NULL DEFAULT 'resolvable'; existing rows backfill
--     to the default with no table rewrite (constant default, PG11+).
-- A scenario with no depth behaves exactly as before. Grants: the table-level
-- GRANT on "scenario" to authenticated (migration 2) already covers new columns.
--
-- Rollback:
--   ALTER TABLE "scenario" DROP COLUMN "resolvability";
--   ALTER TABLE "scenario" DROP COLUMN "resolution_path";
--   ALTER TABLE "scenario" DROP COLUMN "underlying_need";
--   DROP TYPE "Resolvability";

CREATE TYPE "Resolvability" AS ENUM ('resolvable', 'partial', 'unwinnable');

ALTER TABLE "scenario"
  ADD COLUMN "underlying_need" TEXT,
  ADD COLUMN "resolution_path" TEXT,
  ADD COLUMN "resolvability" "Resolvability" NOT NULL DEFAULT 'resolvable';
