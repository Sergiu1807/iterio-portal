import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Runtime uses the Supabase transaction pooler (port 6543). `prepare: false`
// is mandatory there (pgbouncer transaction mode) — same config the rest of
// the fleet runs against Neon poolers.
const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });

export { schema };
