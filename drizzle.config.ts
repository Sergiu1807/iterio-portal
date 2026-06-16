import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// DDL runs over the DIRECT connection (5432); the transaction pooler (6543)
// can't run migrations. Falls back to DATABASE_URL if DIRECT_URL is unset.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
