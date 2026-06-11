// Prisma 7 config — connection URLs live here, not in schema.prisma.
// DATABASE_URL: pooled (Supavisor :6543, pgbouncer) for the app.
// DIRECT_URL:   direct (:5432) for migrations.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Used by the Prisma CLI only (migrate, studio) — the runtime client gets
  // its connection via the PrismaPg adapter in lib/db/admin.ts. Migrations
  // must use the DIRECT (unpooled, :5432) connection.
  datasource: {
    url: process.env.DIRECT_URL ? env("DIRECT_URL") : env("DATABASE_URL"),
  },
});
