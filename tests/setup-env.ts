// Vitest env setup — load .env.local (Next.js convention) then .env.
// Existing process env always wins (dotenv never overrides), so CI's
// service-container DATABASE_URL is unaffected. Missing files are skipped.
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });
