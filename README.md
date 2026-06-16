# Iterio Portal

A personal, multi-brand creative workspace — built code-native (no n8n). One app, a brand
switcher, a distinctive "Soft Canvas" design, 3-path brand onboarding, an Admin Panel for API
keys + usage, and modular creative systems. Each brand you add is instantly usable across every
system.

Lives at the repo root (separable from the StudioFlow portals) so it can be lifted into its own
GitHub/Vercel/Supabase at any time.

## Stack
Next.js 16 (App Router) · React 19 · Tailwind v4 · **Supabase** (Postgres + Auth + Storage) ·
Drizzle ORM · Anthropic + Gemini + Apify (code-native systems).

## Run it

```bash
cd iterio-portal
npm install
cp .env.example .env.local   # fill in Supabase + secrets (see below)
npm run db:migrate           # create tables (uses DIRECT_URL)
# then apply supabase/post-migrate.sql (profiles trigger + RLS + storage bucket)
npm run seed                 # optional: seed demo brands
npm run dev                  # http://localhost:3456
```

### Required env (`.env.local`)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL` (pooler, 6543), `DIRECT_URL` (direct, 5432), `API_KEYS_ENCRYPTION_SECRET`,
`CRON_SECRET`, `ADMIN_EMAILS`. Provider keys (Anthropic/Gemini/Apify) are managed in the Admin
Panel (`api_keys` table), with env as fallback. See `.env.example`.

## Architecture
- **Auth** — Supabase magic-link via `@supabase/ssr`; `requireAuth`/`requireAdmin` + a `profiles`
  role (admin/member/viewer). RLS enabled, deny-by-default; authorization is app-layer.
- **Brands** — Postgres-backed (`src/lib/brands.ts` + `/api/brands*`), surfaced through the same
  `useBrand()` store API. Sub-resources: intelligence sections, products, personas, USPs,
  competitors.
- **System registry** (`src/systems/`) — each system is a self-contained module declaring nav,
  infra needs, and `status` (`placeholder` | `live`). The sidebar, dashboard, and generic
  `/s/[systemKey]` route all render from it; going live = a one-file edit + a `Component`.
- **Async pipelines** — code-native systems (e.g. Competitor Research) run long jobs via an
  Apify-run + cron state machine (`scrape_jobs` + an analysis queue), never blocking a request.
- **Metering** — every external call (Claude/Gemini/Apify) flows through a metered wrapper into
  `usage_events`; the Admin Panel shows spend by provider/system/brand/key.

## Reset
Demo brands live in Postgres (`npm run seed`). The only client state is the selected-brand id in
`localStorage` (`iterio-portal:current:v3`).
