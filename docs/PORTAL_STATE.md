# Iterio Portal — Current State & Roadmap

## Executive summary

Iterio is a personal, single-owner / many-brands creative workspace built code-native — there is **no n8n** anywhere in it. The stack is Next.js 16 (App Router) + React 19 + Tailwind v4 + Radix on Vercel, with all persistent state in a single Supabase Postgres database modeled as one Drizzle schema (~28 tables) and all media in one private Supabase Storage bucket (`iterio-portal-assets`). Access is magic-link only, gated by middleware on pages and `requireAuth()`/`requireAdmin()` inside API routes, against a three-role model (`admin | member | viewer`) whose admin allow-list (`ADMIN_EMAILS`, default `stephen@studio-flow.co`) is reconciled on every login. The whole UI is a "Soft Canvas" design language and — critically — a **registry-driven shell**: the sidebar, dashboard, command palette, and the generic `/s/[systemKey]` renderer all re-render from one `SYSTEMS` array, so flipping a system from "coming soon" to live is a registry edit, not a shell refactor.

Today the portal ships **three live creative systems** (Static Ad Generation, Video Generation, Competitor Research), a **fully-built but unsurfaced Brand Foundation / B3 onboarding engine**, a working **Admin control plane** (encrypted self-service API-key vault + four-axis usage/cost dashboard), and **one registered-but-empty placeholder system** (Brief Generation). Every system that does real work follows one recurring async pattern: write a `pending` DB row, claim it atomically with `FOR UPDATE SKIP LOCKED`, run it under a Vercel cron + `after()` + a ~4s UI tick loop, and meter every AI/scrape call through `recordUsage()` into `usage_events`. There is no separate worker or queue — the database rows *are* the queue.

The defining strategic tension in the codebase is the coexistence of two brand-knowledge models. The original **legacy flat model** (`brands` hub + `intelligence_sections`/`products`/`personas`/`usps`/`competitors`) is what the UI renders and what every generation system grounds on today. The newer **B3 layer** (`brand_intelligence`, a versioned, confidence-scored, source-referenced object) is the intended successor: it exists, it works end-to-end, and on approval it *projects* itself back into the flat model — but **no generation system yet reads `getApprovedBrandIntelligence` directly.** B3 grounds the legacy model, which grounds everything else. Closing that loop is the portal's biggest open lever.

## Architecture at a glance

**Layering (top to bottom):**

- **Edge / request gate** — `src/middleware.ts` runs on every non-`/api` page request, refreshes the Supabase auth cookie (edge-safe, `@supabase/ssr` fetch only), and redirects unauthenticated users to `/login`. The matcher deliberately excludes all of `/api/` (so Next never buffers/truncates multipart bodies at 10 MB) — API routes self-authenticate.
- **App Router (Next 16) + React 19** — one `(portal)` route group sharing `PortalShell`; `/login` and `/auth/callback` sit outside it. Pages are server components that call `getCurrentProfile()`; client surfaces hang off `BrandProvider` + `PortalMetaProvider`.
- **Auth & roles** — `src/lib/auth.ts`: `requireAuth` / `requireAdmin` / `getCurrentProfile`, auto-provisioning a `profiles` row on first login and upgrading allow-listed emails to `admin`. Mutating API routes hard-block `viewer`.
- **Data** — Drizzle ORM over `postgres-js`. Runtime uses the Supabase **transaction pooler (6543, `prepare:false`)**; migrations run against the **direct connection (5432)** via `drizzle.config.ts`. RLS is enabled deny-by-default on the core tables but bypassed by the `postgres` table-owner role — real authorization is entirely app-layer.
- **Storage** — one private bucket `iterio-portal-assets`; every media column stores a **Storage path, not a URL**, resolved to short-lived signed URLs on demand (default 1h; 6h for Kie inputs). SSRF-hardened fetchers (`fetchExternalMedia`, `fetchWebsiteText`, `crawlBrandSite`) guard all untrusted/external pulls.
- **Metered providers** — `server-only` wrappers for Anthropic, Gemini, Kie, Tavily, Apify. Each resolves its key via `getApiKey()` (DB-first, env-fallback, no cache) and funnels spend through `recordUsage()` → `usage_events`. Keys are managed in Admin, AES-256-GCM-encrypted at rest.
- **Execution drivers** — Vercel cron (`vercel.json`, 10 jobs), `after()` for fire-and-forget heavy work, and a per-system ~4s UI tick loop while a page is open.

**The one canonical async-pipeline pattern** recurs in every system that does real work:

> **pending row → atomic claim (`UPDATE … WHERE status='pending' … FOR UPDATE SKIP LOCKED`) → run (provider call + persist to Storage) → guarded finalize (`WHERE status='generating'` so only one writer flips it and records usage) → sweep stuck rows to `error`.**

Idempotency is enforced by a natural-key unique index per pipeline table; transient/dependency waits hand the retry attempt **back** (decrement, never burn) — via `isTransient` checks and, in onboarding, a custom `WaitError`. Systems using this pattern: **Competitor Research** (`scrape_jobs` → `competitor_ads` → `concept_clusters` → `angle_bank_entries`), **Static Generation** (`static_ad_generations`), **Video Generation** (`video_generations`), and **Brand Foundation / B3** (`research_jobs` → `extractions` → `brand_intelligence`).

## End-to-end data flows

**Flow 1 — Onboard a brand → B3 → write-through → grounds everything.**
An operator adds inputs in `/onboarding` (`brand_sources`: website, Meta Ad Library URL, competitors, Amazon/Trustpilot/Google review URLs, a Reddit term, an Instagram handle, pasted emails). `startOnboarding` dispatches each source: website/reviews/reddit/social/email/compliance run as **live internal extracts**; `meta_ads`/`competitor` are **delegated** to the Competitor Research pipeline; `upload` is **deferred**. Jobs are claimed (`FOR UPDATE SKIP LOCKED`), async Apify scrapes poll across passes via `WaitError`, and the website module crawls the site, pulls the Shopify `/products.json` catalog, and runs **Gemini ingredient-vision on PDP label images** (22s wall-clock budget). When every source settles, `synthesizeB3` (Claude **Opus 4.8**) aggregates all `extractions` + competitor winner signals into a versioned `brand_intelligence` draft with `confidenceJson`/`gapsJson`/deterministic `source_refs`. The operator reviews/edits in the 13-tab B3 editor and **approves** — which is the *only* action that calls `projectB3ToLegacy`, fanning B3 into `intelligence_sections`/`products`/`personas`/`usps`/palette/fonts (merging product media so uploads are never wiped; never touching `competitors`). From that moment the legacy flat model — and therefore Static, Video, and the Brand Intelligence page — reflects the approved B3.

**Flow 2 — Competitor Research → Winner → Remake → Static/Video.**
A scrape (`url`/`page_id`/`keyword`, or Tavily auto-discovery) fires Apify's Meta Ads actor and creates a `scrape_jobs` row that walks `pending → running → ingesting → analyzing → scoring → complete`. Ads are deduped on `(brandId, adArchiveId)`, media (incl. every carousel slide) is captured into Storage, Gemini does the vision pass and Claude emits a structured `emit_ad_analysis` teardown, variants cluster into `concept_clusters`, and a composite **Winner Score** + tier is written, denormalized into one `angle_bank_entries` row per concept. On the Winner Board the operator clicks **Remake**: `prepareStaticRemake`/`prepareVideoRemake` build an on-brand prefill (the stored ad thumbnail becomes the Static reference; a fresh deep Gemini read drives the Video script), run an *advisory* compliance gate, write the prefill to `sessionStorage` (`iterio:remake-prefill`), and navigate to `/s/static-generation` or `/s/video-generation`, where the Create form pre-fills and the operator just presses Generate — actual paid generation (and its metered spend) happens only then.

**Flow 3 — Generate a static ad (the canonical creative pipeline).**
In Static Studio's Create tab the operator picks a product, Reference or Brief mode, formats, variation count, and resolution. Agent 1 (Claude vision) produces a format-brief JSON once; Agent 2 runs **per ratio×variation cell in parallel** to compose image prompts; each cell becomes a `pending` `static_ad_generations` row submitted to Kie (Nano Banana 2). The 4s UI tick + the `*/2` cron poll Kie, persist finished images to Storage, and atomically flip rows to `completed` (only the flipping writer records Kie usage — preventing double-billing). Per-tile Refine/Edit actions spawn `gpt-image-2-image-to-image` derivatives linked by `sourceGenerationId`. Video Generation mirrors this end-to-end with Seedance 2 and a 5-stage Claude prompt pipeline.

## System status matrix

| System / Area | Status | What works | Known gaps |
|---|---|---|---|
| **Platform / infra** (DB split, Supabase auth, middleware, `assertCron`, key vault, metering, SSRF fetchers, provider wrappers) | 🟢 Live & verified | All implemented and mutually consistent; DB-first uncached keys propagate instantly | Uneven provider resilience (Kie has no retry/timeout); Kie/Tavily costs are estimates, not invoiced; `next.config.ts` "no backend infra wired" comment is stale |
| **App shell / registry / nav / command palette** | 🟢 Live & verified | Registry-driven sidebar/dashboard/palette/`/s/[systemKey]`; brand switcher; Soft Canvas | `ops` nav group declared but empty; `displayName` plumbed but unrendered; client role-gating limited to the Admin link |
| **Auth & roles** (magic-link, `requireAuth`/`requireAdmin`, auto-provision, `ADMIN_EMAILS`) | 🟢 Live & verified | Full login→callback→session; deny-if-no-row; allow-list admin upgrade on every auth | RLS deny-by-default covers only the 11 core tables (Static/Video/B3 tables not in the loop) — benign given postgres-role bypass, but incomplete |
| **Data model** (Drizzle schema, migrations, brand mapping layer) | 🟢 Live | Hub-and-spoke flat model + B3 layer; idempotency unique indexes; cascade/set-null discipline | `creativeDna` type exists but no table backs it (always `[]`); migration read-set incomplete (0001–0003, 0006–0008 unseen); stale "no DB / stored locally" comments |
| **Brand Onboarding & B3 foundation** | 🟢 Live (E2E-verified on "Happy Mammoth"), but **unsurfaced** | Full code-native pipeline: dispatch, atomic claim, WaitError async-Apify, Opus synthesis, write-through, versioning + diff, approve, assets; all live modules (website incl. Shopify catalog + ingredient-vision, reviews ×3, reddit, social, email, compliance) | **Not in the `SYSTEMS` registry** → no sidebar/dashboard entry; `upload` source deferred (no asset→B3 extraction); B3 creative_dna palette/fonts/logo + several fields not auto-filled; schema/comment drift (`assets` module, unused asset types) |
| **`/brands/new` research path** | 🔵 Placeholder (mock) | A clean brand-creation funnel that routes into `/onboarding` | `synthesizeFromResearch` fabricates a draft locally with a timer-driven progress bar — looks like a feature, is a prototype; paste/wizard paths are real brand creation |
| **Competitor Research** | 🟢 Live & verified | Most-built system: Apify scrape → media capture (incl. carousels) → Gemini+Claude teardown → idempotent clustering → Winner Score/tiers → Angle Bank → weekly radar → Remake bridge; dual driver (tick+cron); stuck sweep | EU reach null in v1 (reach-velocity term + high-confidence tier dormant); **no swipe-library browse/tag UI** (only the bookmark); two placeholder chips in Ad Detail ("Save to Winners"/"Generate Brief"); keyword discovery less precise; remake compliance gate advisory only; ~14 MB Gemini inline cap degrades large video to poster |
| **Static Ad Generation** | 🟢 Live & verified | Setup (research→enrich→author with deterministic template-fill), Reference + Brief modes, two-agent chain, multi-format/variation, Edit copy, Refine product/logo, References + logo libraries, tick+cron, metering, Remake prefill consumer | `static_references.tags` dead field; cron requires `CRON_SECRET` or open-tab tick is the only driver; refine 4K silently coerced; no auto-refine step (manual per-tile) |
| **Video Generation** | 🟢 Live & verified | 3 video types + 4 A-Roll styles, 5-stage Claude prompt pipeline, Seedance 2, idempotent claim/submit, store-or-fallback completion, characters/scenes libraries, multi-variation, tick(5s)+cron+sweep, Remake prefill consumer | **No brand-intelligence grounding** (voice/positioning/compliance not injected); hard-coded 15s prompt design → 5/10s timing copy mistuned; no thumbnails (`thumbnailPath` always null); `sourceGenerationId`/ref `analysisJson`/`tags` schema-only; `submitting` status absent from schema comment |
| **Admin — API Keys** | 🟢 Live & verified | View/set/update/remove 5 keys; AES-256-GCM at rest; env vs custom source; per-key consuming-systems display; uncached DB-first resolution | env-sourced keys not deletable (by design); registry-derived key↔system map (no table) |
| **Admin — Usage / Spend** | 🟢 Live & verified | 24h/7d/30d windows; four-axis rollup (provider/system/key/brand); best-effort guarded | Kie/Tavily figures are estimates; unknown models silently use `DEFAULT_PRICE` |
| **Brief Generation** | 🔵 Placeholder | Registered in `SYSTEMS`; renders `PlaceholderState`; accurate infra readiness badge | No `Component`, route, pipeline, table, or cron. `enabledByDefault: true` (the only system defaulting on) |
| **`ops` / Operations nav group** | ⚪ Not built | — | Declared in types/registry, zero members, filtered out of nav |
| **`n8n` infra kind** | ⚪ Not built (vestigial) | — | `infraReady` hard-returns `false` ("n8n-free lab"); no system declares it — dead/type-completeness only |

## The grounding loop (key strategic gap)

The portal has two brand-knowledge models and the loop between them is **open**.

- **B3 exists and works.** `brand_intelligence` is a versioned, confidence-scored, source-referenced object produced by the onboarding pipeline and synthesized by Opus 4.8. `getApprovedBrandIntelligence(brandId)` (`contract.ts`) is the stable accessor explicitly built for new downstream code to call — *"the function new downstream code is meant to call."*
- **But nothing downstream calls it yet.** On approval, `projectB3ToLegacy` (`writethrough.ts`) projects B3 into the legacy flat tables, and **every generation system reads only that legacy/flat grounding**:
  - **Static Generation** grounds via `brandDna(brand, siteText)` over the brand record (palette, products, USPs, `intelligence_sections` — including the `constraints` section B3 projects). It consumes the *projection*, not B3.
  - **Video Generation** has **no brand-intelligence grounding at all** — neither legacy nor B3 — relying solely on the user's script + a generic archetype library.
  - **Competitor Research** injects only the brand's top 2 `intelligence_sections` as analysis context, and its Remake bridge adapts copy "in our brand voice" off the brand record — again the flat model.
  - **Brief Generation** would be the natural first true B3 consumer, but it is a placeholder.

So the live grounding chain is **B3 → (approve) → legacy flat model → all generation systems.** B3 only influences output transitively, after write-through; no system reads the versioned object, its confidence scores, gaps, or compliance rules directly. Closing the loop means pointing new/updated generation grounding at `getApprovedBrandIntelligence` (with the flat model as fallback) — and giving Video any grounding at all.

## Cross-cutting gaps, risks & tech debt

- **The grounding loop is open** (above) — the single highest-leverage gap. B3 is built but read by nothing; Video has no grounding whatsoever.
- **Brand Foundation is unregistered.** A fully-functional, cron-served system (`research-poll`/`research-extract`/`research-sweep`) has no entry in `SYSTEMS`, so it has no sidebar/dashboard presence. Either deliberately hidden or in-progress — needs a decision.
- **`/brands/new` research path is a convincing mock** (`synthesizeFromResearch` + timer progress). Highest "looks-real-but-isn't" risk for a stakeholder; the real engine is `/onboarding`.
- **FIXED-prompt constraints** are real and binding: Static Agent 1/2 must preserve strict JSON/prose output contracts; Video prompts (Studio Flow V2 + the 10 templates) are hard-coded to a **15-second** design with anti-glitch/reference-lock rules and must not be edited — so 5s/10s renders inherit 15s-tuned timing copy (a real, unsurfaced UX gotcha).
- **Provider resilience is uneven.** Anthropic (SDK retries+timeout), Gemini and `fetchExternalMedia` (manual retries+timeout) are hardened; **Kie has neither retry nor explicit timeout** (relies on the tick loop), and Tavily has a timeout but no retry.
- **Cost figures are partly estimates.** Only Anthropic/Gemini (real tokens) and Apify (real `usageTotalUsd`) are accurate; Kie image/video and Tavily are flat estimates, and unknown models silently fall back to `DEFAULT_PRICE` — Admin → Usage Kie/Tavily totals are approximate by design.
- **Cron is the only always-on driver, gated on `CRON_SECRET`.** Without it set in prod, every cron route 500s and the sole pipeline driver becomes the open-tab UI tick — silently degrading every async system.
- **RLS coverage is incomplete.** Deny-by-default is applied only to the 11 core/platform tables; Static/Video/B3 tables aren't in the loop. Benign under the postgres-role bypass + app-layer auth, but the post-migrate file is out of date relative to the schema.
- **Single-owner assumptions** run throughout: full-array replace on brand sub-resource PATCH ("low write volume"), localStorage brand selection (non-authoritative), a default `ADMIN_EMAILS` of one address. Fine today; load-bearing if the model ever broadens.
- **Dead / vestigial code & schema drift:** `creativeDna` (no backing table, always `[]`); `kind:"n8n"` infra branch (always false, unused); `static_references.tags`, video `analysisJson`/`tags`, `sourceGenerationId` (schema-only); `ops` nav group (empty); `assets` research module named but with no runner; stale comments in `next.config.ts`, `types.ts`, and the "Remove brand"/"stored locally" dialogs.
- **No thumbnails for video** (`thumbnailPath` never populated); **no swipe-library browse UI**; two dead placeholder chips in the Ad Detail modal.
- **Untested / lower-confidence paths:** several base nav targets (`/brands`, `/brand-intelligence`, `/admin`) and the unread migrations (0001–0003, 0006–0008) were not directly verified in the section read-set, though the schema clearly evolved past them.

## Where to head next — prioritized roadmap

**P0 — close the grounding loop (the strategic core).**
1. **Make generation systems read `getApprovedBrandIntelligence` directly** (B3 first, flat model as fallback). Rationale: B3 is fully built and verified but read by nothing — the entire onboarding investment only reaches output transitively through write-through. This is the single highest-leverage change.
2. **Give Video Generation brand grounding.** Rationale: it currently injects *no* brand voice/positioning/compliance — "on-brand video" is impossible until B3 (or at least the flat model) feeds the prompt pipeline; today outputs inherit a generic wellness/DTC archetype bias.
3. **Decide and act on Brand Foundation's registry status.** Rationale: a working, cron-served system is invisible to the operator. Either register it (`SYSTEMS`) to surface the onboarding workspace as a first-class system, or document that `/onboarding` is its intentional entry point.

**P1 — finish the systems that are 90% there.**
4. **Build Brief Generation** as the first true B3 consumer (it's already `enabledByDefault: true` and the natural bridge from Competitor Research's "Generate Brief" placeholder). Rationale: removes the only placeholder in the Create group and exercises the grounding contract.
5. **Add a Swipe Library browse/tag/annotate UI** in Competitor Research. Rationale: the backend (snapshots, niche-compounding, tags/notes) is fully built but write-only — saved winners can't be viewed or curated.
6. **Replace or clearly label the `/brands/new` research mock.** Rationale: a fabricated-locally draft with a fake progress bar is a stakeholder-trust risk; route it transparently into the real `/onboarding` engine or remove it.
7. **Auto-fill B3 creative_dna (palette/fonts/logo) and link assets.** Rationale: these fields are editable but never populated by research, so creative grounding still leans on the legacy onboarding record.

**P2 — hardening, hygiene & polish.**
8. **Harden Kie** (add retry + explicit timeout to the wrapper) so resilience doesn't depend on an open tab. 
9. **Verify `CRON_SECRET` is set in prod and add a self-check**, since its absence silently kills every always-on pipeline driver.
10. **Generate video thumbnails** (`thumbnailPath` is dead) for usable gallery posters.
11. **Surface the 5s/10s video timing mismatch** to the user (the prompts are FIXED, but the UX can warn that scripts are tuned for 15s).
12. **Extend RLS deny-by-default to Static/Video/B3 tables** and refresh `post-migrate.sql`; clean up dead fields and stale comments (`creativeDna`, `n8n` infra, `ops` group, "stored locally" dialogs, `next.config.ts`).

## Inconsistencies / things to verify

- **Brand Foundation system key vs registry.** Crons import from `@/systems/brand-foundation/pipeline` and the onboarding section uses the system key `brand-onboarding` for metering, yet there is **no `brand-foundation` (or `brand-onboarding`) entry in `SYSTEMS`**. Confirm the canonical key and whether the system should be registered.
- **`enabledByDefault` polarity.** The one *placeholder* (Brief Generation) defaults **on**, while all three *live* creative systems default **off**. Intentional (placeholders advertise; live systems are opt-in per brand), but worth confirming it's the desired operator experience.
- **Encryption-secret hygiene is portal-specific.** Iterio derives the key from `secret.trim()`, so `API_KEYS_ENCRYPTION_SECRET` must have **no** trailing newline — the *opposite* of the `base+"\n"` requirement noted for some other fleet portals. Verify the stored Vercel value matches Iterio's convention or every key bricks.
- **Module naming gotcha (Static).** The two-agent prompt logic lives in `chain.ts`; `pipeline.ts` is the Kie poll/advance module. References to "the static pipeline" can mean either — verify which when editing.
- **Migration read-set is incomplete.** Numbering jumps `0000 → 0004 → 0005 → 0009`; many live columns/tables (e.g. `products.video_image_url`, the full `concept_clusters`/`angle_bank_entries`/`swipe_library` tables, `competitor_ads` media/teardown/scoring columns and the `(brandId, adArchiveId)` unique index) live in unseen migrations. The schema is the source of truth; the four read migrations don't fully describe its evolution.
- **`creativeDna` contradiction.** The `CreativeDna` type and mock brands populate it, but `mapBrand()` always returns `creativeDna: []` and no table backs it. Either wire a table or remove the type — currently it reads as a feature that silently does nothing.
- **Middleware `isPublic` allowlist for `/api/cron` and `/api/webhooks` is dead** — the matcher already excludes all of `/api/`, so those entries never execute. Cosmetic, but misleading.
- **Status taxonomy drift (Video).** Code uses and sweeps a `submitting` status that the `video_generations` schema comment omits. Harmless, but the comment should be corrected.
- **"Brand Foundation" cron `maxDuration` and the 60s tick vs 22s vision budget.** The website ingredient-vision loop is capped at 22s specifically so a 60s tick route can claim it — verify the tick route's `maxDuration` stays ≥ that budget if either changes.


---

# Detailed System Sections

I have read all the listed files in full. Here is the documentation section.

## Platform, Infrastructure & Providers

This area is the shared foundation every Iterio system stands on: the runtime/build stack, request-time auth gating, the cron authorization gate, the encrypted API-key vault, usage metering + cost estimation, Supabase storage helpers with SSRF protection, and the thin metered wrappers around each external AI/scrape provider. Nothing here is brand- or system-specific; it is the plumbing that the creative systems call into.

### Tech Stack & Versions

| Concern | Choice | Version (from `package.json`) |
|---|---|---|
| Framework | Next.js (App Router) | `next` `16.1.6` |
| UI runtime | React | `react` / `react-dom` `19.2.3` |
| Styling | Tailwind CSS v4 (+ typography plugin) | `tailwindcss` `^4`, `@tailwindcss/postcss` `^4`, `@tailwindcss/typography` `^0.5.19` |
| Component primitives | Radix UI | dialog `^1.1.15`, dropdown-menu `^2.1.16`, label `^2.1.8`, scroll-area `^1.2.10`, select `^2.2.6`, slot `^1.2.4`, tabs `^1.1.13`, tooltip `^1.2.8` |
| ORM | Drizzle | `drizzle-orm` `^0.45.2`, `drizzle-kit` `^0.31.10` (dev) |
| Postgres driver | `postgres` (postgres-js) | `^3.4.9` |
| Auth / DB platform | Supabase | `@supabase/ssr` `^0.12.0`, `@supabase/supabase-js` `^2.108.2` |
| AI SDK | Anthropic | `@anthropic-ai/sdk` `^0.104.2` |
| Scraping | Apify | `apify-client` `^2.23.4` |
| Image processing | `sharp` | `^0.35.1` |
| Misc UI | `lucide-react`, `cmdk`, `next-themes`, `sonner`, `react-markdown` + `remark-gfm`, `class-variance-authority`, `clsx`, `tailwind-merge` | — |
| Tooling | TypeScript `^5`, ESLint `^9` + `eslint-config-next`, `tsx` `^4.22.4`, `dotenv` `^17.4.2` | — |

**Scripts** (`package.json:5-14`): `dev`/`start` run on port **3456**; `db:generate` / `db:migrate` / `db:studio` are Drizzle-kit; `seed` runs `scripts/seed.ts` via `tsx`.

**TypeScript** (`tsconfig.json`): `strict: true`, `moduleResolution: "bundler"`, `target: ES2017`, and the `@/*` → `./src/*` path alias used everywhere in this area.

**`next.config.ts`**: minimal — only pins the Turbopack workspace `root` to `__dirname` because a parent lockfile exists in the surrounding monorepo. The comment "Frontend-only prototype — no backend infra wired yet" is **stale/misleading** — the backend (Supabase, Drizzle, providers, cron) is in fact wired. Worth flagging as a documentation gap.

### Database connectivity (`src/lib/db/index.ts`)

- Single shared Drizzle client over `postgres-js`, built from `process.env.DATABASE_URL`.
- Runtime uses the **Supabase transaction pooler (port 6543)**, so `prepare: false` is mandatory (pgbouncer transaction mode rejects prepared statements).
- Exports both `db` and `schema`; `server-only` import guard prevents accidental client bundling.
- **`drizzle.config.ts`** points DDL/migrations at the **direct connection** via `DIRECT_URL` (port 5432), falling back to `DATABASE_URL`. The transaction pooler cannot run migrations — this split (runtime=6543 pooled, migrations=5432 direct) is a deliberate constraint. Migrations live in `./drizzle`, schema in `./src/lib/db/schema.ts`.

### Supabase clients (three flavors)

| Helper | File | Key used | RLS | Use |
|---|---|---|---|---|
| `createSupabaseBrowserClient()` | `src/lib/supabase/browser.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | enforced | Client components; memoized singleton |
| `createSupabaseServerClient()` | `src/lib/supabase/server.ts` | anon key, cookie-bound | enforced | Server Components, route handlers, server actions. Cookie `setAll` is wrapped in try/catch because a Server Component can't mutate cookies (only middleware/route handlers can) |
| `supabaseAdmin()` | `src/lib/supabase/admin.ts` | `SUPABASE_SERVICE_ROLE_KEY` | **bypassed** | Server-only; cron routes + Storage helpers. Lazy singleton (`persistSession:false`, `autoRefreshToken:false`) so a build without env vars doesn't throw at import |

### Middleware: auth gating (`src/middleware.ts`)

The Next.js middleware refreshes the Supabase auth cookie on **every page request** and gates routes. Design notes:

- **Edge-safe**: uses only `@supabase/ssr` `createServerClient` (fetch-based), never the postgres driver.
- It calls `supabase.auth.getUser()` and then:
  - **Public paths** (no gate): anything under `/login`, `/auth`, `/api/cron`, `/api/webhooks`.
  - If **no user** and the path is non-public → redirect to `/login`.
  - If a **logged-in user** hits `/login` → redirect to `/dashboard`.
- **Matcher excludes `/api/`** entirely (`config.matcher`, lines 53-60). Two stated reasons:
  1. Route handlers self-authenticate via `requireAuth()` (defined elsewhere in the app, not in these files).
  2. Running middleware on `/api` makes Next **buffer + truncate request bodies at 10 MB**, which corrupts multipart uploads.
  - Static assets (`_next/static`, `_next/image`, `favicon.ico`, and `.svg/.png/.jpg/.jpeg/.gif/.webp/.ico`) are also excluded.
- **Gotcha worth noting:** the `/api/cron` and `/api/webhooks` allowlist in the matcher is effectively moot because the matcher already excludes all of `/api/` — those API routes never run through middleware at all; they rely on their own gates (`assertCron`, route-level auth).

### Cron authorization (`src/lib/cron.ts`)

`assertCron(req)` is the single gate for Vercel-cron-driven routes:

- In `NODE_ENV === "development"` → returns `null` (open, no auth) so local cron testing works.
- In prod: requires `CRON_SECRET`. Missing secret → `500 {"error":"CRON_SECRET not configured"}`. Wrong/absent `Authorization: Bearer <CRON_SECRET>` header → `401 Unauthorized`. Match → `null` (proceed).
- `server-only` guarded. Returns a `NextResponse` to short-circuit, or `null` to continue — the calling route checks the return value.

### Async pipeline model (context)

Per the project design, async pipelines are code-native (no n8n): a pipeline writes a `pending` DB row, work is driven by `after()` and/or a Vercel cron hitting a route guarded by `assertCron`, the UI polls on a ~4s tick, and rows are claimed atomically via `FOR UPDATE SKIP LOCKED`. The files in this area provide the metering, providers, storage, and cron-gate those pipelines consume; the per-system route handlers and SQL live outside this area.

### Encrypted API-key store (`src/lib/api-keys.ts`)

Self-service key storage so an admin can paste keys in the Admin Panel rather than redeploying env vars.

- **Cipher:** AES-256-GCM. Stored format is `iv:authTag:ciphertext` (all hex), per `encryptKey()`/`decryptKey()`.
- **Key derivation:** `sha256(API_KEYS_ENCRYPTION_SECRET.trim())` → 32-byte key (`getEncryptionKey()`, lines 14-20). The `.trim()` is deliberate: it guards the **documented fleet gotcha** where a trailing newline on the env var silently changes the derived key and bricks every stored key. (Note: a sibling memory entry warns some portals require `base+"\n"` instead of trim — Iterio explicitly chose `.trim()`, so the encryption secret here must be stored without a trailing newline.)
- **Resolution order — `getApiKey(keyName)` (lines 52-64):** reads the `api_keys` table **first, with NO cache**, decrypts `encrypted_value` if present; on any DB error or missing row, falls back to `process.env[keyName]` (trimmed). Returns `""` if neither. The no-cache design means an admin key update takes effect on the very next provider call across every system.
- **`getConfiguredKeyNames()` (lines 67-79):** the union of key names present in `api_keys` plus any `CONFIGURABLE_KEYS` whose env var is non-empty. Drives system "readiness."
- **`maskKey()`:** shows `first6…last4` (or `••••••••` for ≤12-char keys) for display.
- **`CONFIGURABLE_KEYS` (lines 82-88)** — the canonical list of manageable keys, each with `label`/`description` for the Admin Panel:

| keyName | Provider | Purpose (per description) |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude | Creative analysis, brief & copy generation |
| `GEMINI_API_KEY` | Google Gemini | Vision analysis of competitor video/image creatives |
| `APIFY_TOKEN` | Apify | Meta / TikTok / Instagram scrapers (Competitor Research) |
| `TAVILY_API_KEY` | Tavily | Web search for competitor auto-discovery |
| `KIE_AI_API_KEY` | Kie AI | Nano Banana 2 + GPT Image 2 (Static Ads), Seedance 2 (Video) |

**DB touched:** reads/writes the `api_keys` table — columns `key_name` (`keyName`) and `encrypted_value` (`encryptedValue`). This file only reads; writes happen in the Admin Panel route (outside this area).

### Infra readiness (`src/lib/infra.ts`)

Client-safe helpers that translate a system's `infra: InfraRequirement[]` into ready/not-ready against a `Set<string>` of configured key names (sourced from `PortalMeta` = `api_keys` table + env):

- `infraReady(req, configured)` — **any `kind === "n8n"` requirement always returns `false`** ("this lab is n8n-free"), so an n8n-typed requirement permanently gates a system off. Otherwise it's `configured.has(req.keyName)`.
- `infraStatus()` maps each requirement to `{req, ready}`; `allInfraReady()` is true when there are no requirements or all are ready.
- `keysForSystem(systemKey)` and `systemsForKey(keyName)` derive the key↔system mapping straight from `SYSTEMS` in `@/systems/registry` — no separate mapping table.

### Usage metering & cost model (`src/lib/usage.ts`)

Every provider call funnels its cost into one `usage_events` table via `recordUsage()`. This is the spend-tracking backbone for Admin → Usage.

**`recordUsage(e)` (lines 60-75):** inserts into `schema.usageEvents` with columns `provider`, `system_key`, `brand_id`, `key_name`, `model`, `units` (jsonb), `cost_usd` (stored as a fixed 6-decimal string), `meta` (jsonb), `created_at`. It is **best-effort** — wrapped in try/catch and only `console.warn`s on failure, so a metering hiccup never breaks the caller's pipeline.

`UsageProvider` enum: `"anthropic" | "gemini" | "apify" | "kie" | "tavily"`.

**Cost estimators (all USD):**

- **`computeTokenCost(model, in, out)`** — per-million pricing table `PRICE_PER_MILLION`:

  | Model | input $/M | output $/M |
  |---|---|---|
  | `claude-opus-4-8` | 15 | 75 |
  | `claude-opus-4-6` | 15 | 75 |
  | `claude-sonnet-4-6` | 3 | 15 |
  | `claude-sonnet-4-5-20250929` | 3 | 15 |
  | `claude-haiku-4-5-20251001` | 0.8 | 4 |
  | `gemini-2.5-flash` | 0.3 | 2.5 |
  | `gemini-2.0-flash` | 0.1 | 0.4 |
  | (unknown) `DEFAULT_PRICE` | 3 | 15 |

- **`computeImageCost(model, resolution="2K")`** — `IMAGE_PRICE`: `nano-banana-2` = {1K:0.015, 2K:0.02, 4K:0.04}; `gpt-image-2-image-to-image` = {1K:0.03, 2K:0.05, 4K:0.08}; falls back to that model's 2K, else `0.02`.
- **`computeVideoCost(model, duration=10)`** — `VIDEO_PRICE`: `bytedance/seedance-2` = {5:0.25, 10:0.5, 15:0.75}; falls back to that model's 10s, else `0.5`.
- **Apify cost** is **not estimated** — it comes from the real run object (`usageTotalUsd`), see `recordApifyUsage`.

> All image/video figures are explicitly labeled **best-effort estimates** because Kie bills separately; only Anthropic/Gemini token cost is computed from real returned token counts, and only Apify uses real reported spend.

**`getUsageRollup(windowDays)` (lines 86-119):** sums `cost_usd` and counts events since `now − windowDays`, grouped four ways in parallel — `byProvider`, `bySystem` (`system_key`), `byKey` (`key_name`), `byBrand` (`brand_id`) — plus `total`/`events`. Null group keys normalize to `"—"`; each list is sorted by descending cost. This is the data behind the Admin Usage dashboard.

**DB touched:** `usage_events` (read in rollup, write in `recordUsage`).

### Supabase Storage helpers + SSRF guards (`src/lib/storage.ts`)

All persistent media lives in the **`iterio-portal-assets`** Supabase Storage bucket. `server-only`; uses `supabaseAdmin()` (service role).

**Core storage ops:**

- `storagePath(brandSlug, kind, filename)` → `brands/<slug>/<kind>/<filename>`, slug/kind sanitized to `[a-z0-9-]`. (Example: `brands/naali/scraped-meta-ads/123.mp4`.)
- `uploadToStorage(path, body, contentType)` — `upsert: true`; returns the path.
- `signedUrl(path, expiresIn=3600)` — creates a signed URL (default 1h); returns `null` on error or null path.
- `downloadFromStorage(path)` → `Buffer`.
- `imageBase64FromPath(path)` → `{ base64, mediaType }` for building Claude vision blocks (mediaType inferred from extension, default `image/jpeg`).
- `extFromContentType(ct)` — content-type → file extension (defaults to `jpg`).

**SSRF + size guard (the security-critical part):**

- `isPrivateIp(ip)` — blocks IPv4 `0/8`, `10/8`, `127/8`, `169.254/16`, `172.16–31`, `192.168/16`, and IPv6 loopback/ULA/link-local/IPv4-mapped-private ranges.
- `assertPublicHost(hostname)` — rejects `localhost`, `*.internal`, `*.local`; **DNS-resolves** the host (`dns.lookup(all)`) and requires **every** resolved address to be non-private.
- `fetchExternalMedia(url, {maxBytes=200MB, timeoutMs=20s})` — the hardened fetcher for **untrusted Apify/CDN media** (lines 87-166):
  - https-only; SSRF host check pre-fetch.
  - **Bounded retry** ×3 on transient failures (429 / 5xx / network / timeout), honoring `Retry-After`, else `500ms × attempt` backoff; non-retryable statuses (403/404, other <500) abort immediately.
  - **Post-redirect host re-check** — if the final URL's host differs and isn't public, reject (`ssrf-redirect`).
  - Size guard on both declared `content-length` and actual byte length.
  - **Content-type resolution chain:** response header → URL extension (`contentTypeFromUrl`) → magic-byte sniff (`sniffContentType` for JPEG/PNG/WEBP/GIF/MP4) — must end up `image/*` or `video/*` or it's rejected. This handles CDNs that omit or mislabel content-type.
  - Every rejection path logs a structured `console.warn("[media] reject", …)`.
- `fetchWebsiteText(rawUrl, {maxChars=12k, timeoutMs=15s})` — SSRF-guarded, https-only HTML fetcher with a custom `IterioBot/1.0` UA; strips `<script>/<style>/<noscript>`, tags, and common HTML entities to readable text; caps raw HTML at 600k chars; same post-redirect re-check. Used by the Static Ad prompt builder for brand voice/visual research.
- `crawlBrandSite(rootUrl, {maxPages=6, maxCharsPerPage=5000})` — fetches the homepage, extracts same-origin links, filters via `CRAWL_KEEP` (about/story/faq/ingredient/product/etc.) and `CRAWL_SKIP` (cart/checkout/policy/asset files), **ranks** product/ingredient pages first (where dosages/ingredients live), then about/story/faq, then the rest, and returns `{url, text}` per page (via `fetchWebsiteText`). Used for richer brand onboarding.

### Small utilities

- **`src/lib/color.ts`** — pure client-safe color helpers: `hexToHslTriplet()` (for `hsl(var(--x))` theming, handles 3- and 6-char hex), `readableOn()` (luminance-based dark/light foreground using the brand's warm palette `#2a2622`/`#fdfaf3`), `monogram()` (two-letter brand initials).
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `slugify()`, `formatDate()` (en-GB short), `uid(prefix)` (`crypto.randomUUID` with a Math.random fallback).

### Provider wrappers

Every provider wrapper is `server-only`, pulls its key via `getApiKey()` (DB-first → env), throws a clear `"<KEY> is not configured"` if missing, and records spend via `recordUsage()` with `systemKey`/`brandId` metering context threaded through. Summary:

| Provider | File | Model(s) / endpoint | Metering | Retry / timeout |
|---|---|---|---|---|
| Anthropic Claude | `providers/claude.ts` | `claude-sonnet-4-6` default; endpoint = official SDK `messages.create` | real token counts → `computeTokenCost` | SDK `maxRetries: 4` (exp backoff), `timeout` 60s default (overridable) |
| Google Gemini | `providers/gemini.ts` | `gemini-2.5-flash`; raw REST `v1beta/models/...:generateContent` | real token counts → `computeTokenCost` | manual ×3 retry on 429/5xx/network, `600ms×attempt`; `AbortSignal.timeout(60s)` |
| Kie AI | `providers/kie.ts` | `nano-banana-2`, `gpt-image-2-image-to-image`, `bytedance/seedance-2`; REST `api.kie.ai/api/v1/jobs/{createTask,recordInfo}` | per-image/video estimate (caller invokes `recordKieImageUsage`/`recordKieVideoUsage`) | **none built-in** (no retry, no explicit timeout) |
| Tavily | `providers/tavily.ts` | `api.tavily.com/search` | flat per-search ($0.008 advanced / $0.005 basic) | none beyond `AbortSignal.timeout(30s)`; no retry |
| Apify | `providers/apify.ts` | `apify-client` SDK (actor `start`, `run.get`, `dataset.listItems`) | **real** `usageTotalUsd` from the run | SDK-managed |
| Video seam | `providers/video-provider.ts` | delegates to Kie Seedance 2 | via Kie helpers | via Kie |

#### Anthropic — `providers/claude.ts`

- `DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6"`.
- `callClaude(params)`: instantiates `new Anthropic({ apiKey, maxRetries: 4, timeout: timeoutMs ?? 60_000 })`. The comment notes the extra retries/timeout headroom let the SDK's exponential backoff absorb transient blips **before they count against the pipeline's own attempt budget** — a deliberate interaction with the async-claim retry model.
- Supports `system`, `messages`, `maxTokens` (default 4096), `temperature`, `tools`, `toolChoice`. Records `inputTokens`/`outputTokens` from `resp.usage` with `keyName: "ANTHROPIC_API_KEY"`.
- Helpers: `toolResult<T>(resp, toolName?)` — extracts a forced `tool_use` block's input (the structured-output pattern); `textOf(resp)` — concatenates text blocks.

#### Gemini — `providers/gemini.ts`

- Hardcoded `MODEL = "gemini-2.5-flash"`. Raw REST call via `x-goog-api-key` header.
- Supports inline media (single or array — e.g. every card of a carousel) for **vision**, and `grounded` Google-Search grounding. **Constraint:** grounding and inline media are mutually exclusive (throws if both supplied).
- `temperature: 0.3`, `maxOutputTokens` default 1024.
- Grounded responses append a `SOURCES:` block of up to 12 deduped cited URLs harvested from `groundingMetadata.groundingChunks`.
- Records `promptTokenCount`/`candidatesTokenCount` as tokens.

#### Kie AI — `providers/kie.ts`

- Async job API: `createTask` (POST) returns a `taskId`; `pollKieJob(taskId)` (GET `recordInfo`) returns `{state, resultUrls, errorMessage, costTime}`. State map normalizes `running→processing`, `queued→pending`, `fail→failed`, etc.
- `createTask` tolerates Kie's `code` being either `200` or `0` and digs `taskId` out of `data.taskId` or top-level.
- **`submitNanoBanana`** — static gen; `image_input` up to 14 URLs; defaults `aspect_ratio:"auto"`, `resolution:"2K"`, `output_format:"png"`.
- **`submitGptImage2`** — refine/edit (image-to-image); maps the portal's broader aspect set onto GPT Image 2's supported subset (`mapAspectForGpt2`); enforces Kie quirks in code: `auto` aspect caps to **1K**, and `1:1` cannot use **4K** (downgraded to 2K). Fixed refine prompts `REFINE_PROMPT_PRODUCT` / `REFINE_PROMPT_LOGO` are exported (ported from the proven portal flow).
- **`submitSeedanceVideo`** — `reference_image_urls` (omitted when empty), defaults `aspect_ratio:"9:16"`, `duration:10`, `resolution:"720p"`, `generate_audio:true`, `web_search:false`.
- Usage recorders `recordKieImageUsage` / `recordKieVideoUsage` write estimated cost (Kie bills separately).
- **Quirk/gotcha:** unlike the Gemini/Tavily/media fetchers, the Kie HTTP calls have **no retry loop and no explicit fetch timeout** — a hung Kie request relies on the platform default. Polling/retry is expected to be handled by the calling pipeline's tick loop.

#### Tavily — `providers/tavily.ts`

- `tavilySearch(params)` POSTs to `api.tavily.com/search`; defaults `search_depth:"advanced"`, `include_answer:true`, `max_results:10`; 30s timeout, no retry.
- Returns `{answer, results[{title,url,content}]}`. Flat cost: `$0.008` advanced / `$0.005` basic.

#### Apify — `providers/apify.ts`

- Uses the official `apify-client`. `startApifyRun(actorId, input)` is **fire-and-forget** (`actor().start()`), returning `{runId, datasetId}` immediately — fitting the async pipeline model.
- `getApifyRun(runId)` returns `{status, datasetId, usageUsd}` (status ∈ READY/RUNNING/SUCCEEDED/FAILED/ABORTED/TIMED-OUT).
- `listApifyDataset<T>(datasetId, limit=1000)` fetches dataset items with `clean: true`.
- `recordApifyUsage()` logs the **real** `usageTotalUsd` from the finished run (with `meta.runId`).

#### Video provider seam — `providers/video-provider.ts`

- An indirection layer so future providers (MUAPI, fal, …) can be added without touching callers. Switches on `VIDEO_PROVIDER` env (default `"kie"`, quote-stripped and lowercased).
- `submitVideoJob` / `pollVideoJob` currently always route to Kie Seedance 2; `videoModelId()` returns `SEEDANCE_VIDEO_MODEL` for metering.
- **Status:** the `muapi` branch is a commented-out placeholder (`// case "muapi": …`) — only Kie is live. This is intentional scaffolding, not a bug.

### Environment variables this area depends on

| Env var | Used by |
|---|---|
| `DATABASE_URL` | `db/index.ts` (runtime, pooler 6543) |
| `DIRECT_URL` | `drizzle.config.ts` (migrations, 5432) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | middleware + browser/server Supabase clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabaseAdmin()` (storage, cron) |
| `API_KEYS_ENCRYPTION_SECRET` | `api-keys.ts` (AES key derivation) |
| `CRON_SECRET` | `assertCron` |
| `VIDEO_PROVIDER` | `video-provider.ts` (default `kie`) |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `APIFY_TOKEN`, `TAVILY_API_KEY`, `KIE_AI_API_KEY` | provider env fallbacks (DB takes precedence) |

### Current status, gaps & notable design decisions

- **Live / solid:** DB connection split (pooled runtime vs. direct migrations), three-tier Supabase auth, page-level middleware gating, `assertCron`, the encrypted key vault with no-cache DB-first resolution, usage metering + four-axis rollup, the SSRF-hardened media/website/crawl fetchers, and all five provider wrappers. These are all fully implemented and consistent with each other.
- **Intentional scaffolding (not gaps):** the video-provider `muapi` branch (commented out); the n8n `InfraRequirement` kind that always reports not-ready (this lab is n8n-free by design).
- **Documentation gaps:** the `next.config.ts` comment "Frontend-only prototype — no backend infra wired yet" contradicts the actual (fully wired) backend and should be corrected. The middleware's `/api/cron` and `/api/webhooks` entries in `isPublic` are dead in practice because the matcher excludes all of `/api/`.
- **Inconsistency to be aware of:** retry/timeout discipline is uneven across providers — Anthropic (SDK retries+timeout), Gemini (manual retries+timeout), and `fetchExternalMedia` (manual retries+timeout) are hardened, but **Kie has neither retry nor explicit timeout**, and Tavily has a timeout but no retry. Resilience for Kie depends on the calling pipeline's poll/tick loop rather than the wrapper.
- **Cost model caveat:** all Kie image/video costs and Tavily costs are flat **estimates**; only Anthropic/Gemini (real token counts) and Apify (real `usageTotalUsd`) reflect true spend, so Admin → Usage totals for Kie/Tavily are approximate by design.
- **Encryption-secret hygiene:** because Iterio derives the key from `secret.trim()`, the `API_KEYS_ENCRYPTION_SECRET` must NOT carry a trailing newline (the opposite of the `base+"\n"` requirement noted for some other portals in the fleet); getting this wrong bricks every stored key.

**Key file references:** `package.json`; `src/middleware.ts:39-48` (gate logic), `:53-60` (matcher); `next.config.ts:5`; `drizzle.config.ts:13`; `src/lib/cron.ts:5-13`; `src/lib/infra.ts:7-10` (n8n always-false); `src/lib/api-keys.ts:14-20` (key derivation), `:52-64` (`getApiKey`), `:82-88` (`CONFIGURABLE_KEYS`); `src/lib/usage.ts:7-44` (price tables), `:60-75` (`recordUsage`), `:86-119` (`getUsageRollup`); `src/lib/storage.ts:38-60` (SSRF), `:87-166` (`fetchExternalMedia`), `:248-288` (`crawlBrandSite`); `src/lib/db/index.ts:9-12`; `src/lib/supabase/admin.ts:10-18`; `src/lib/providers/claude.ts:24-55`; `src/lib/providers/gemini.ts:22-83`; `src/lib/providers/kie.ts:62-141` (submit fns), `:143-181` (poll); `src/lib/providers/tavily.ts:22-58`; `src/lib/providers/apify.ts:13-63`; `src/lib/providers/video-provider.ts:27-41`.

---

I have all the files I need. Here is the documentation section.

## Data Model (Postgres / Drizzle schema)

### Purpose

The Iterio portal is a personal, code-native, multi-brand creative workspace. Its entire persistent state lives in a single Supabase Postgres database, defined as one Drizzle ORM schema file (`src/lib/db/schema.ts`) and materialized through ordered SQL migrations under `drizzle/`. Everything in the portal — the brands themselves, their intelligence, every async AI/scrape pipeline, all generated media, the new versioned brand-foundation layer, plus auth and metering — is modeled here. There is **no n8n and no external data store**; pipelines are driven entirely by DB rows (pending → claimed → completed) read by Vercel cron jobs and a UI tick loop.

The schema currently defines **~28 tables**. They fall into six functional groups, documented below.

---

### How brands actually load (the brand-store + brands.ts mapping layer)

Before the tables, it's important to understand that the UI does **not** read these tables directly. There are two layers:

- **Server-side mapping (`src/lib/brands.ts`)** — `getAllBrands()` (`brands.ts:51`) and `getBrandById()` (`brands.ts:141`) read the `brands` hub row plus its five legacy sub-resource tables (`intelligence_sections`, `products`, `personas`, `usps`, `competitors`) and fold them — via `mapBrand()` (`brands.ts:12`) — into a single denormalized `Brand` domain object (shape defined in `src/lib/types.ts:72`). Writes go the other way: `createBrandFromDraft()` (`brands.ts:101`) and `updateBrandRecord()` (`brands.ts:157`) take a partial `Brand`/`BrandDraft` and fan it back out into the normalized tables.
- **Client-side store (`src/lib/brand-store.tsx`)** — `BrandProvider` fetches `/api/brands`, holds the full brand list in React state, tracks `currentBrandId`, and exposes `useBrand()`. The "current brand" selection is persisted to `localStorage` under the key `iterio-portal:current:v3` (`brand-store.tsx:14`) but the comment explicitly notes this is **"UI convenience only (not authoritative)"** — the brand list itself always comes from the DB. The provider also sets a per-brand `--brand-tint` CSS variable from `brandColor` (`brand-store.tsx:72`).

#### Key design decisions / gotchas in the mapping layer

| Decision | Detail | File:line |
|---|---|---|
| Full-array replace on update | Any sub-resource array present in a PATCH is **deleted and re-inserted wholesale** (not diffed). Justified by "single-owner lab → low write volume". | `brands.ts:157-194` |
| Product media is resolved on demand | `image_url` / `video_image_url` store **Supabase Storage paths**, not URLs. `getBrandProductMedia()` (`brands.ts:80`) resolves fresh **signed URLs** per request (private bucket) rather than persisting them onto the Brand object. | `brands.ts:74-89` |
| Default enabled systems on create | New brands are seeded with `{ "brief-generation": true, "static-generation": false, "video-generation": false, "competitor-research": false }`. | `brands.ts:120` |
| `storagePrefix` defaults to the slug | Drives the per-brand Storage path namespace. | `brands.ts:121` |
| `creativeDna` is dead in the DB | `mapBrand()` always returns `creativeDna: []` (`brands.ts:47`). The `CreativeDna` type exists (`types.ts:59`) and mock brands populate it, but **no table backs it** — the production data path always yields empty. **Gap / unused.** | `brands.ts:47` |
| `fonts` not written on create | `createBrandFromDraft` never sets `fonts` (only `palette`), though `updateBrandRecord` can patch it. Minor inconsistency. | `brands.ts:101-123` |
| Stale type comment | `src/lib/types.ts:2` still says *"No DB yet — these are plain shapes held in the client-side store."* This is now inaccurate; the shapes are DB-backed. **Documentation drift, not a functional gap.** |

#### `src/lib/mock-brands.ts` — legacy seed, now effectively dead

`MOCK_BRANDS` defines three richly-populated demo brands (Naali, Aurelia Coffee, Vespera). The comment at the top frames them as prototype seeds for "the client-side store." Since brands now load from the DB via `/api/brands`, this file is **legacy/unused in the live data path** unless explicitly imported by a seed routine — treat it as a fixture, not production state.

---

### Group 1 — Core brand model (the "legacy flat" model)

This is the original hub-and-spoke model: one `brands` hub with five flat sub-resource tables, all `brand_id`-scoped with `ON DELETE cascade`. Defined in `drizzle/0000_init.sql` and `schema.ts:36-150`.

| Table | Purpose | Key columns | FKs / indexes |
|---|---|---|---|
| `profiles` | 1:1 with Supabase `auth.users`. App identity + role. | `id` (== auth.users.id, no `defaultRandom`), `email`, `role` (admin/member/viewer, default `member`), `displayName`, `lastBrandId`, `isActive` | `id → auth.users(id) ON DELETE cascade` (added in **post-migrate.sql**, not Drizzle) |
| `brands` | The hub. One row per brand. | `name`, `slug` (**unique**), `website`, `category`, `primaryMarket`, `currency`, `tagline`, `vibe`, `brandColor` (default `#5A7A64`), `palette` (jsonb `PaletteColor[]`), `fonts` (jsonb), `cluster`, `status` (default `Active`), `onboardingSource` (research/paste/wizard), `enabledSystems` (jsonb keyed by registry key), `storagePrefix` | `ownerId → profiles.id ON DELETE set null`; `brands_owner_idx`; unique `slug` |
| `intelligence_sections` | Free-text Brand Intelligence sections (the legacy "doc"). | `title`, `sectionType` (`SectionType` enum-ish string: identity/audience/products/usps/voice/visual/competitors/constraints), `content`, `sortOrder` | `brandId` cascade; `intel_brand_idx` |
| `products` | Brand product catalogue. | `name`, `category`, `keyBenefits`, `price`, `productUrl`, `imageUrl` (1:1 — Static Gen), `videoImageUrl` (9:16 — Video Gen), `isHero` | `brandId` cascade; `products_brand_idx` |
| `personas` | Audience personas. | `name`, `demographics`, `psychographics`, `painPoints`, `desires` | `brandId` cascade; `personas_brand_idx` |
| `usps` | Unique selling propositions. | `text`, `category`, `isPrimary` | `brandId` cascade; `usps_brand_idx` |
| `competitors` | Competitor list **and** the scraper source list (doubles as both). | `name`, `websiteUrl`, `instagramHandle`, `tiktokHandle`, `metaPageId`, `metaSearchTerms`, `metaLibraryUrl`, `country` (default `ALL`), `type`, `niche`, `isActive`, `radarEnabled` (pin for weekly re-scrape), `lastScrapedAt` | `brandId` cascade; `competitors_brand_idx` |

**Note on `competitors`:** the schema explicitly comments it "Doubles as the competitor SCRAPER source list" (`schema.ts:127`). Several scrape-relevant columns (`metaPageId`, `metaSearchTerms`, `metaLibraryUrl`, `niche`, `radarEnabled`, `lastScrapedAt`) were **added after** `0000_init.sql` (which only had `meta_page_id`/`meta_search_terms`) — they appear in `schema.ts` but not the initial migration, so they arrived in a later migration not in the read set.

#### Legacy flat model vs. the new versioned B3

The legacy model stores brand knowledge as **loose, mutable, denormalized rows** (a list of free-text sections, products, personas, usps). It is what `brands.ts`/`Brand`/`brand-store` operate on today and what the UI renders. It has **no versioning, no confidence scoring, no source provenance** — editing a section overwrites it in place.

The **B3 layer** (`brand_intelligence`, Group 5) is the intended successor: a single versioned, immutable-per-version JSON object with confidence scores, gaps, and source references, plus a `draft → approved` lifecycle. The two coexist; the flat model remains the live grounding source for generation systems, while B3 is the foundation layer being built around the research pipeline.

---

### Group 2 — Competitor Research pipeline

Async, code-native scrape→analyze→score→curate pipeline. The `pending → … → complete` status machine + atomic claim (`FOR UPDATE SKIP LOCKED`, applied in app code) is the backbone described in the project overview.

| Table | Purpose | Key columns | FKs / unique indexes |
|---|---|---|---|
| `scrape_jobs` | One async job per competitor scrape. FSM driver. | `competitorId`, `systemKey` (default `competitor-research`), `platform` (meta/tiktok/instagram), `mode` (keyword/page_id), `query`, `country`, `requestedCount`, `niche`, `status` (**pending/running/ingesting/analyzing/scoring/complete/error**), `apifyRunId`, `apifyDatasetId`, `stats` jsonb (`adsFound/adsNew/adsAnalyzed/conceptsScored`), `costUsd` | `brandId` cascade, `competitorId → set null`; `scrape_jobs_brand_idx`, `scrape_jobs_status_idx` |
| `competitor_ads` | One scraped + AI-analyzed ad. The richest table in the schema. | identity/dedup: `adArchiveId`, `adGroupId`, `collationId`, `competitorPageId`, `dedupCount`; snapshot: `snapshotDate`, `adStartDate`, `metaSortRank`, `isDco`; **media (Storage paths)**: `mediaType`, `primaryThumbnail`, `videoPath`, `mediaCards[]`, `mediaCardItems[]` (per-card image/video), `fullMediaAsset`; capture diagnostics: `mediaCaptureFailed`, `mediaCaptureAttempts`, `sourceMediaUrls`; copy: `displayPrimaryText`, `headlineTitle`, `ctaButtonType`, `destinationUrl`, `adLibraryUrl`, `publisherPlatforms[]`; **AI analysis (9 fields)**: `creativeAngle`, `adDescription`, `targetPersona`, `coreMotivation`, `proofMechanism`, `visualHook`, `spokenHook`, `outroOffer`, `fullTranscript`, `geminiDescription`; **richer teardown (additive/backfilled)**: `awarenessLevel`, `emotionalDriver`, `secondaryDrivers[]`, `beatStructure[]`, `visualNotes`, `nativeScore` (0.000–1.000), `complianceFlags[]`; **winner scoring**: `stillActive`, `firstSeenActive`, `lastSeenActive`, `activeDays`, `resurrected`, `conceptId`; **analysis queue**: `aiAnalysisStatus` (queued/processing/complete/failed), `aiErrorMessage`, `aiAttempts`, `aiLastAnalyzedAt` | `brandId` cascade, `scrapeJobId → set null`; **unique `competitor_ads_brand_archive_uidx (brandId, adArchiveId)`** (dedup key); `competitor_ads_brand_idx`, `..._analysis_status_idx`, `..._concept_idx` |
| `concept_clusters` | Variant grouping + composite Winner Score. One row per (brand, conceptKey). | `competitorId`, `conceptKey` (`collation:<id>` / `adgroup:<id>` / `texthash:<hash>`), `clusterMethod`, `representativeAdId`, aggregated signals (`activeVariantCount`, `totalVariantCount`, `distinctFormats`, `formats[]`, `firstSeen`, `lastSeenActive`, `activeDays`, `peakActiveDays`, `stillActive`, `resurrected`), reach (`euTotalReach`, `euReachPerDay` — v1 null), score (`winnerScore`, `winnerTier` = proven_control/scaling_now/in_testing/historical_swipe, `confidence`), `countHistory[]` (time-series for WoW momentum), `lastScoredRunId` (idempotency guard) | `brandId` cascade, `competitorId → set null`; **unique `concept_clusters_brand_key_uidx (brandId, conceptKey)`** (makes re-runs idempotent); `..._brand_idx`, `..._score_idx (brandId, winnerScore)` |
| `angle_bank_entries` | Structured teardown per concept — the research **output** and the remake **input**. | `conceptId`, `representativeAdId`, `advertiser`, lifecycle dates, `format`, `platforms[]`, teardown fields (`offer`, `angle`, `hook`, `mechanism`, `awarenessLevel`, `emotionalDriver`, `secondaryDrivers[]`, `beatStructure[]`, `visualNotes`, `nativeScore`, `complianceFlags[]`), score snapshot (`winnerScore`, `winnerTier`, `signals` jsonb, `confidence`), curation (`status` = raw/approved, `usedInGenerations[]`) | `brandId` cascade, `conceptId → cascade`, `representativeAdId → set null`; **unique `angle_bank_concept_uidx (conceptId)`** (one entry per concept); `..._brand_idx`, `..._status_idx (brandId, status)` |
| `swipe_library` | Saved/curated winners; compounds per niche. | `angleBankEntryId`, `conceptId`, `niche`, `tags[]`, `note`, `snapshot` jsonb (**survives concept deletion**), `savedBy` | `brandId` cascade, `angleBankEntryId/conceptId → set null`, `savedBy → set null`; `swipe_brand_idx`, `swipe_niche_idx` |

**Lifecycle:** `scrape_jobs` (pending) → Apify scrape → `competitor_ads` rows inserted (deduped on `(brandId, adArchiveId)`) with `aiAnalysisStatus='queued'` → AI analysis fills the teardown fields → scoring pass groups ads into `concept_clusters` (idempotent on `conceptKey`, history appended once per `lastScoredRunId`) → each concept gets one `angle_bank_entries` row (raw→approved curation) → operators save winners to `swipe_library` (snapshot-preserved so it survives upstream deletes). Note that `competitor_ads.conceptId` is a **soft reference** (a plain `uuid`, not a declared FK) to `concept_clusters.id`.

**Migration note:** `0000_init.sql` created `competitor_ads` with only the original 9 AI fields and **no** unique `(brandId, adArchiveId)` index, no media/teardown/scoring columns, and no `concept_clusters`/`angle_bank_entries`/`swipe_library` tables. Those are all later additions present in `schema.ts` but in migrations beyond the read set — so the competitor-research model grew substantially after the initial cut.

---

### Group 3 — Static Ad Generation

Defined in `drizzle/0004_static_ad_system.sql` + `schema.ts:444-506`. Per-brand two-agent prompt config + generated images + a reference library.

| Table | Purpose | Key columns | FKs / unique |
|---|---|---|---|
| `static_ad_config` | **One row per brand**: the two-agent system prompts + logo. | `agent1Prompt` (vision: reference ad → JSON), `agent2Prompt` (composer: brief+product+voice → image prompt), `briefAgent1Prompt`/`briefAgent2Prompt` (optional brief-mode variants), `brandLogoPath` (Storage path, gates "Refine logo"), `status` (placeholder/building/ready/error), `isPlaceholder`, `buildError`, `builtAt` | `brandId` cascade + **UNIQUE(brandId)** |
| `static_ad_generations` | One row per generated image (incl. refine/edit derivatives). | `productId`, `mode` (custom/brief/refined/edited), `status` (pending/generating/completed/error), `kieModel` (nano-banana-2 / gpt-image-2-image-to-image), `kieJobId`, `aspectRatio` (default 1:1), `resolution` (default 2K), `outputFormat` (default png), `finalPrompt` (Agent 2 out), `analysisJson` (Agent 1 out), `referencePath`, `adCopy`, `imagePath` (final Storage path), `batchId`/`batchIndex`/`batchSize`, `sourceGenerationId` (parent for refined/edited), `attempts`, `errorMessage` | `brandId` cascade, `productId → set null`; `static_gen_brand_status_idx`, `static_gen_batch_idx` |
| `static_references` | Per-brand reference-image library (replaces the old global inspiration library). | `name`, `imagePath` (Storage path), `tags` | `brandId` cascade; `static_ref_brand_idx` |

**Providers/models:** Kie AI — `nano-banana-2` (generation) and `gpt-image-2-image-to-image` (refinement). Placeholder prompts let the system work out of the box; `status` advances placeholder→building→ready as the "Set up Static system" prompt builder authors real prompts.

---

### Group 4 — Video Generation

Defined in `drizzle/0005_video_generation.sql` + `schema.ts:515-587`. Note: **video prompts are universal/in-code — there is no per-brand video config table** (deliberate, mirroring the "FIXED prompts" rule). Only per-brand Characters & Scenes libraries plus the generations table exist.

| Table | Purpose | Key columns | FKs / indexes |
|---|---|---|---|
| `video_characters` | Per-brand reusable talent references. | `name`, `description`, `imagePath` (headshot, Storage path), `analysisJson`, `tags` | `brandId` cascade; `video_char_brand_idx` |
| `video_scenes` | Per-brand reusable scene/background references. | `name`, `description`, `imagePath`, `analysisJson`, `tags` | `brandId` cascade; `video_scene_brand_idx` |
| `video_generations` | One row per generated video. | `productId`, `characterId`, `sceneId`, `videoType` (ugc/broll/aroll), `arollStyle` (street-interview/talking-head/podcast/green-screen), `mode` (descriptive sub-mode: product_only/product_character/no_ref/…), `status`, `kieModel`, `kieJobId`, `duration` (default 10), `aspectRatio` (default 9:16), `resolution` (default 720p), `outputFormat` (mp4), `script`, pipeline intermediates (`crafterPrompt`, `studioFlowPrompt`, `finalPrompt`), `videoPath`, `thumbnailPath`, batch fields, `sourceGenerationId`, `attempts`, `errorMessage` | `brandId` cascade; `productId/characterId/sceneId → set null`; `video_gen_brand_status_idx`, `video_gen_batch_idx` |

The pipeline-intermediate columns (`crafterPrompt`, `studioFlowPrompt`, `finalPrompt`) expose the multi-step prompt chain for inspection. There is **no unique index on `video_generations`** — generations are append-only and identified by `id`/`batchId`.

---

### Group 5 — Brand Onboarding & Foundation Layer (B3)

Defined in `drizzle/0009_icy_robin_chapel.sql` + `schema.ts:595-747`. This is the newer, versioned brand-foundation system and its feeding research pipeline. It mirrors the competitor-research async FSM design (worker rows + status machine + idempotency unique indexes).

| Table | Purpose | Key columns | FKs / unique indexes |
|---|---|---|---|
| `brand_sources` | Operator-entered research sources (one per URL/handle). | `type` (website/meta_ads/competitor/amazon/trustpilot/google_reviews/reddit/social/email/upload), `url`, `handle`, `config` jsonb, `status` (idle/queued/running/complete/failed/partial), `enabled`, `lastRunAt`, `lastError` | `brandId` cascade; **unique `brand_sources_brand_type_url_uidx (brandId, type, url)`**; `..._brand_idx` |
| `research_jobs` | One worker row per research stage (P2+). Mirrors `scrape_jobs` FSM. | `sourceId`, `module` (website/reviews/compliance/meta_ads/competitor/assets), `type` (fetch/extract/delegated), `status` (pending/running/complete/failed), `provider` (apify/tavily/gemini/claude/internal), `apifyRunId`, `apifyDatasetId`, `costCents`, `attempts`, `maxAttempts` (default 3), `error`, `meta` | `brandId` cascade, `sourceId → cascade`; `research_jobs_brand_status_idx`, `..._source_idx` |
| `raw_artifacts` | Pointer rows for large raw blobs (blobs in Storage). | `jobId`, `kind` (page/ad/review/post/transcript/asset), `storageKey`, `externalId` (dedup key), `meta` | `brandId` cascade, `jobId → cascade`; **unique `raw_artifacts_job_external_uidx (jobId, kind, externalId)`** |
| `extractions` | Structured AI extraction per source (one current row per (source, schemaType); re-run **upserts**). | `sourceId`, `jobId`, `schemaType` (website_intel/voc/compliance/…), `json`, `confidence` (0.000–1.000), `model` | `brandId` cascade, `sourceId → cascade`, `jobId → set null`; **unique `extractions_source_schema_uidx (sourceId, schemaType)`**; `..._brand_schema_idx` |
| `brand_assets` | Operator uploads + auto-pulled PDP images (Storage). | `type` (logo/font/palette/brand_book/product_photo/packaging/winning_creative), `storageKey`, `sourceId`, `meta` (origin/productUrl/width/height/hex/filename/contentType) | `brandId` cascade, `sourceId → set null`; **unique `brand_assets_brand_key_uidx (brandId, storageKey)`**; `..._brand_type_idx` |
| `compliance_rules` | Brand-specific, jurisdiction-aware compliance ruleset (P3). | `subject` (ingredient/claim), `jurisdiction` (US_FTC_FDA / EU_EFSA_DSA), `verdict` (safe/risky/banned), `rationale`, `evidenceSource`, `brandRunsThisClaim`, `confidence` | `brandId` cascade; **unique `compliance_brand_subject_juris_uidx (brandId, subject, jurisdiction)`** |
| `brand_intelligence` | **THE B3** — versioned Brand Intelligence object (the single grounding source). | `version` (int), `status` (draft/approved), `json` (the B3 object), `confidenceJson` (per-field scores), `gapsJson` (`{field, severity, reason}[]`), `sourceRefsJson`, `approvedBy`, `approvedAt` | `brandId` cascade, `approvedBy → profiles.id set null`; **unique `brand_intel_brand_version_uidx (brandId, version)`**; `..._brand_status_idx` |

**B3 lifecycle:** operator adds `brand_sources` → `research_jobs` fetch/extract via Apify/Tavily/Gemini/Claude → raw blobs land in `raw_artifacts`, structured outputs upsert into `extractions` (one per source+schema) → these synthesize into a versioned `brand_intelligence` row (`draft`), with `confidenceJson`/`gapsJson`/`sourceRefsJson` describing trust and provenance → operator approves (`status='approved'`, `approvedBy`/`approvedAt`), and version-diffing is supported by the `(brandId, version)` unique index. `compliance_rules` are a P3 jurisdiction-aware output of the same pipeline.

**Status note:** The phase markers in the schema comments ("P2+", "P3") indicate B3 is **partially built** — the tables and FSM exist, but research stages are tiered by phase. This is a foundation layer being stood up around the pipeline, not yet the live grounding source for generation (the legacy flat model still serves that role).

---

### Group 6 — Platform tables (auth, keys, metering)

| Table | Purpose | Key columns | Indexes |
|---|---|---|---|
| `profiles` | (also Group 1) auth identity + role. | `role`, `lastBrandId`, `isActive` | FK to auth.users via post-migrate |
| `api_keys` | Admin-managed external API keys, **encrypted at rest**. | `keyName` (**unique**), `encryptedValue`, `label`, `description`, `updatedBy` | unique `key_name` |
| `usage_events` | Unified metering — one row per external call (`recordUsage`). | `provider` (anthropic/gemini/apify), `systemKey` (registry key), `brandId`, `keyName`, `model`, `units` jsonb (`Record<string, number>`), `costUsd` (numeric 12,6), `meta` | `usage_provider_created_idx`, `usage_system_created_idx`, `usage_brand_created_idx` |

`usage_events` uses a `bigserial` PK (the only non-uuid PK in the schema) and `brandId` is a **plain uuid (no FK)** so metering rows survive brand deletion. All three indexes are `(dimension, createdAt)` composite, optimized for time-windowed roll-ups by provider/system/brand.

---

### Migrations + post-migrate.sql (RLS / seed)

Migrations live in `drizzle/` and are applied in order via `npm run db:migrate`. The four read here:

| Migration | What it creates |
|---|---|
| `0000_init.sql` | The platform + legacy flat core: `api_keys`, `brands`, `competitor_ads` (original 9-field version, no media/teardown/scoring), `competitors` (original columns only), `intelligence_sections`, `personas`, `products` (no `videoImageUrl` yet), `profiles`, `scrape_jobs`, `usage_events`, `usps` + all FKs/indexes. |
| `0004_static_ad_system.sql` | `static_ad_config`, `static_ad_generations`, `static_references`. |
| `0005_video_generation.sql` | `video_characters`, `video_generations`, `video_scenes`. |
| `0009_icy_robin_chapel.sql` | The full B3 layer: `brand_assets`, `brand_intelligence`, `brand_sources`, `compliance_rules`, `extractions`, `raw_artifacts`, `research_jobs`. |

**Gap in the read set:** the migration numbering jumps `0000 → 0004 → 0005 → 0009`. Migrations `0001–0003`, `0006–0008` exist but were not provided. Because `schema.ts` contains many columns/tables/indexes **not present in any of the four read migrations** (e.g. `products.video_image_url`; `competitors.meta_library_url/niche/radar_enabled/last_scraped_at`; the full `concept_clusters`/`angle_bank_entries`/`swipe_library` tables; `competitor_ads` media/teardown/scoring columns; `competitor_ads_brand_archive_uidx`; the `media_card_items`/`source_media_urls` columns), those changes live in the unread migrations. The four read here cover the schema's skeleton but **not its full evolution**.

#### `supabase/post-migrate.sql` — runs AFTER `db:migrate`, idempotent

This file does what Drizzle cannot (it touches Supabase's `auth` and `storage` schemas):

1. **`profiles.id → auth.users(id)`** FK with `ON DELETE cascade`, guarded by a `pg_constraint` existence check (idempotent). This is why `profiles.id` has **no `defaultRandom()`** in Drizzle — the ID is the Supabase auth user id.
2. **`handle_new_user()` trigger** (`SECURITY DEFINER`) on `auth.users` insert → auto-creates a `public.profiles` row with `role='member'` (`ON CONFLICT (id) DO NOTHING`). The comment notes the app upgrades `ADMIN_EMAILS` users to admin on login.
3. **RLS: enabled + deny-by-default** on `profiles, brands, intelligence_sections, products, personas, usps, competitors, api_keys, usage_events, scrape_jobs, competitor_ads`. **No policies are created** — RLS is deliberately deny-all. The Drizzle pooler connects as the `postgres` table-owner role which **bypasses RLS**, so all real access flows through app-layer `requireAuth()`; RLS only closes the PostgREST (supabase-js anon/authed) path.
4. **Private Storage bucket** `iterio-portal-assets` (public=false) — all media is served via signed URLs only (consistent with `brands.ts` resolving signed URLs on demand).

**RLS gap worth flagging:** the deny-by-default loop only lists the 11 core/platform tables from `0000_init`. The Static (`0004`), Video (`0005`), and B3 (`0009`) tables are **not** in this loop — so unless a later migration or a separate post-migrate step enables RLS on them, those tables do **not** have RLS enabled. This is benign given the postgres-role bypass + app-layer auth model, but it means RLS coverage is incomplete and the file is out of date relative to the schema. **Gap.**

---

### Cross-cutting design notes & constraints

- **Storage paths, not URLs**: every media-bearing column (`products.image_url`, `competitor_ads.*`, `static_*.image_path`, `video_*.image_path`/`video_path`, `brand_assets.storage_key`, `raw_artifacts.storage_key`) stores a **Supabase Storage key**, resolved to a time-limited signed URL on demand (private bucket).
- **Idempotency via unique indexes**: every async pipeline table has a natural-key unique index so re-runs upsert rather than duplicate — `competitor_ads (brandId, adArchiveId)`, `concept_clusters (brandId, conceptKey)`, `angle_bank_entries (conceptId)`, `extractions (sourceId, schemaType)`, `raw_artifacts (jobId, kind, externalId)`, `brand_assets (brandId, storageKey)`, `compliance_rules (brandId, subject, jurisdiction)`, `brand_intelligence (brandId, version)`.
- **Status FSMs are app-enforced**: the `status` columns encode the pipeline state machines (`scrape_jobs`, `research_jobs`, `static_ad_generations`, `video_generations`, `competitor_ads.aiAnalysisStatus`, `brand_sources`); transitions and the `FOR UPDATE SKIP LOCKED` atomic claim live in the API/cron code, not in DB constraints.
- **Cascade vs set-null discipline**: brand-owned rows cascade on brand delete; cross-references that must survive (`competitorId`, `productId`, `scrapeJobId`, `approvedBy`, `savedBy`, `representativeAdId`, asset `sourceId`) are `ON DELETE set null`; `usage_events.brandId` has no FK at all so metering history is never destroyed.
- **Soft/undeclared references**: `competitor_ads.conceptId`, `concept_clusters.representativeAdId`/`lastScoredRunId`, `static/video.sourceGenerationId`, and `static/video.batchId` are plain `uuid` columns (no FK) — intentional, to avoid ordering/circular-FK problems in the fan-out pipelines.

---

I now have everything I need to write a comprehensive, accurate section.

## App Shell, Navigation, Auth & System Registry

### Purpose

This is the structural backbone of the Iterio portal: the route layout, the authentication and role model, and a **registry-driven shell** in which every "system" (Brief Generation, Static Generation, Video Generation, Competitor Research) is a declarative entry rather than a hand-wired page. Adding a system, reordering the nav, or flipping a system from a "coming soon" placeholder to a live tool is a single registry edit — the sidebar, dashboard, command palette, the generic `/s/[systemKey]` route, and the per-system "needs setup" indicators all re-render from that one source. The whole shell is wrapped in a deliberate "Soft Canvas" visual design language.

---

### Route Groups & Layout Tree

The app uses the Next.js App Router with one route group and a small set of top-level routes.

| Route / file | Kind | Role |
|---|---|---|
| `src/app/layout.tsx` | Root layout | Fonts, `ThemeProvider`, global `Toaster`, `<html>`/`<body>` shell |
| `src/app/page.tsx` | Page | `/` immediately `redirect("/dashboard")` (`src/app/page.tsx:4`) |
| `src/app/login/page.tsx` | Page (public) | Magic-link login screen |
| `src/app/auth/callback/route.ts` | Route handler (public) | OTP code → session cookie exchange |
| `src/app/(portal)/layout.tsx` | Group layout | Renders `<PortalShell>` (sidebar + main + command palette) |
| `src/app/(portal)/dashboard/page.tsx` | Page | Workspace home (hero + stats + system grid) |
| `src/app/(portal)/s/[systemKey]/page.tsx` | Dynamic page | Generic per-system renderer |
| `src/app/api/me/route.ts` | Route handler | Returns the caller's role/email + configured key names |

The `(portal)` route group means `dashboard`, `s/[systemKey]`, and the other authenticated pages (`/brands`, `/onboarding`, `/brand-intelligence`, `/admin`, referenced in the sidebar) all share the `PortalShell` chrome, while `/login` and `/auth/callback` deliberately sit **outside** the group so they render without the sidebar.

#### Root layout (`src/app/layout.tsx`)

- Loads three Google fonts as CSS variables: **Fraunces** (`--font-display`, includes italic), **Hanken Grotesk** (`--font-body`), and **Spline Sans Mono** (`--font-mono`) — the "Soft Canvas" type system (`layout.tsx:7-26`).
- Sets `<html suppressHydrationWarning>` (required because `next-themes` mutates the class on `<html>`).
- Wraps children in `ThemeProvider` with `attribute="class"`, `defaultTheme="light"`, `enableSystem={false}`, `disableTransitionOnChange` (`layout.tsx:37`). System theme is intentionally disabled — light is the default; dark is opt-in via the toggle.
- Mounts a Sonner `<Toaster position="bottom-right">` with hard-coded cream toast styling (`layout.tsx:39-49`).
- Page `metadata` title is "Iterio Portal — Creative Workspace".

#### Portal shell (`src/components/layout/portal-shell.tsx`)

`PortalShell` composes the client-side provider stack and layout frame:

```
<PortalMetaProvider>      // role/email/configuredKeys from /api/me
  <BrandProvider>         // brands + current brand (from /api/brands)
    <TooltipProvider delayDuration={200}>
      <div flex min-h-screen>
        <PortalSidebar/>
        <main> ...max-w-[1600px] padded container... {children} </main>
      </div>
      <CommandPalette/>    // global ⌘K
```

The main content is centered with `max-w-[1600px]` and responsive padding (`portal-shell.tsx:17`). Note: every consumer of `useBrand()` / `usePortalMeta()` lives under this tree, so those hooks are only valid inside the `(portal)` group.

---

### Authentication & Session

#### Login (`src/app/login/page.tsx`)

A client component. The user enters an email and submits; it calls Supabase browser-client `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: \`${origin}/auth/callback\` } })` (`login/page.tsx:20-23`). It's a **passwordless magic-link** flow only — no password field. Status is a small state machine (`idle | sending | sent | error`); on success it shows a "Check your email" confirmation with a "Use a different email" reset. The footer copy explicitly states "Only allow-listed emails get access."

#### Auth callback (`src/app/auth/callback/route.ts`)

A GET route handler. Reads `code` (and optional `next`, default `/dashboard`) from the query, calls `supabase.auth.exchangeCodeForSession(code)` via the **server** Supabase client (which writes the session cookie), and redirects to `next` on success or `/login?error=auth` on failure (`auth/callback/route.ts:11-18`).

#### Middleware session gate (`src/middleware.ts`)

Runs on every non-API request and is **edge-safe** (uses `@supabase/ssr`'s `createServerClient`, i.e. fetch only — never the Postgres driver).

- Refreshes the Supabase auth cookie on each request via the `getAll`/`setAll` cookie adapter (`middleware.ts:13-26`).
- Calls `supabase.auth.getUser()` and computes `isPublic` for paths starting with `/login`, `/auth`, `/api/cron`, or `/api/webhooks` (`middleware.ts:33-37`).
- **Unauthenticated + non-public → redirect to `/login`.** **Authenticated + on `/login` → redirect to `/dashboard`** (`middleware.ts:39-48`).
- The `matcher` **excludes `/api/`**, `_next` assets, and image files. Two documented reasons (`middleware.ts:53-60`): API route handlers self-authenticate via `requireAuth()`, and running middleware on `/api` makes Next buffer + truncate request bodies at 10 MB, which would corrupt multipart uploads. So pages get the session gate; API auth is enforced inside each handler.

#### Server-side auth & role model (`src/lib/auth.ts`)

This is `server-only`. The role type is `"admin" | "member" | "viewer"` (`auth.ts:7`). Key functions:

| Function | Returns | Behavior |
|---|---|---|
| `requireAuth()` | `AuthResult \| NextResponse` | Validates the Supabase session; loads the joined `profiles` row; returns `401` if no user, `403` if no/inactive profile. **Auto-provisions** a profile on first call if the signup trigger hasn't, then **auto-upgrades** to admin if allow-listed. |
| `requireAdmin()` | `AuthResult \| NextResponse` | Calls `requireAuth()` then `403` "Admin only" if `role !== "admin"`. |
| `getCurrentProfile()` | `Profile \| null` | Page-friendly variant for Server Components — returns `null` instead of a `NextResponse`, so a page can `redirect()`. Same auto-provision logic. |
| `isAuthError(result)` | type guard | True if the result is a `NextResponse` (the standard `if (isAuthError(auth)) return auth;` pattern in route handlers). |
| `ensureAdminRole(...)` | profile | Private helper: `ADMIN_EMAILS` is the source of truth — an allow-listed user is upgraded to `admin` and persisted on every auth. |

Allow-list comes from `adminEmails()`: `process.env.ADMIN_EMAILS` (comma-separated, lowercased), defaulting to **`stephen@studio-flow.co`** (`auth.ts:22-27`). Auto-provision logic: if no `profiles` row exists for `user.id`, insert one with `role = admin` if the email is allow-listed else `viewer`, with `onConflictDoNothing()`, then re-select (`auth.ts:47-59`). So a brand-new allow-listed login lands as `admin`; everyone else defaults to `viewer`.

**DB tables/columns:** reads/writes `schema.profiles` — columns referenced are `id` (Supabase user id), `email`, `role`, `displayName`, `isActive`. The `Profile` type is `{ id, email, role, displayName, isActive }`.

#### `/api/me` and the client-side `PortalMeta`

- `src/app/api/me/route.ts`: `GET` calls `requireAuth()`, then `getConfiguredKeyNames()` (from `@/lib/api-keys`), and returns `{ role, email, displayName, configuredKeys }` (`api/me/route.ts:9-14`). `configuredKeys` is the set of API/service key names currently present (sourced from the `api_keys` table + env), which drives per-system "needs setup" badges.
- `src/lib/portal-meta.tsx`: `PortalMetaProvider` fetches `/api/me` once on mount and exposes `usePortalMeta()` → `{ role, email, configuredKeys: Set<string>, isReady }` (`portal-meta.tsx:14-45`). On any failure it still flips `isReady=true` so the UI doesn't hang. This is the **client-side mirror** of the server auth result.

---

### System Registry — Single Source of Truth

The registry is the conceptual center of this area.

#### Type contract (`src/systems/types.ts`)

`SystemDefinition` fields:

| Field | Meaning |
|---|---|
| `key` | Stable slug → URL `/s/<key>` and the per-brand "enabled" settings key |
| `name`, `icon` (Lucide), `tagline`, `description`, `capabilities[]` | Display copy (cards + placeholder hero) |
| `status` | `"placeholder" \| "live"` |
| `nav` | `{ group: "create" \| "research" \| "ops"; order: number; hidden?: boolean }` |
| `infra` | `InfraRequirement[]` — what the system needs to function |
| `perBrand?`, `enabledByDefault?` | Per-brand toggle semantics |
| `accent` | Per-system accent hex (kept in the Soft Canvas warm range) |
| `Component?` | `ComponentType<{ brandId: string }>` — wired **only** when `status === "live"`; placeholders need none |

`InfraRequirement` is a discriminated union of `{ kind: "apiKey" }`, `{ kind: "service" }`, or `{ kind: "n8n"; workflowKey }` (`types.ts:11-14`). `NAV_GROUP_LABELS` maps groups to display labels: Create / Research / Operations (`types.ts:38-42`).

#### The registry array (`src/systems/registry.ts`)

```ts
export const SYSTEMS: SystemDefinition[] = [
  briefGeneration, staticGeneration, videoGeneration, competitorResearch,
];
```

Helpers (the API every shell surface uses):
- `getSystem(key)` — lookup or `null` (`registry.ts:20`).
- `navSystems()` — non-hidden systems sorted by `nav.order` (`registry.ts:24`).
- `systemsByGroup()` — buckets `navSystems()` into the fixed order `["create","research","ops"]`, dropping empty groups (`registry.ts:28-33`).

The file's docstring states the design intent explicitly: "The sidebar, dashboard, command palette and the generic `/s/[systemKey]` route all render from this array — so adding a system (or flipping one from placeholder → live) is a registry edit, not a shell refactor."

#### Registered systems (current state)

Each system is its own module under `src/systems/<name>/index.ts`, exporting a single `SystemDefinition`. Live systems lazy-import their `component` (`lazy(() => import("./component"))`); the placeholder does not define a `Component`.

| System | `key` | Group / order | Status | Default on? | Accent | Infra requirements |
|---|---|---|---|---|---|---|
| **Brief Generation** | `brief-generation` | create / 10 | **placeholder** | `enabledByDefault: true` | `#5A7A64` (sage) | `ANTHROPIC_API_KEY` |
| **Static Generation** | `static-generation` | create / 20 | **live** | off (`false`) | `#C2785A` (clay) | `ANTHROPIC_API_KEY`, `KIE_AI_API_KEY` |
| **Video Generation** | `video-generation` | create / 30 | **live** | off | `#6E5A86` (plum) | `ANTHROPIC_API_KEY`, `KIE_AI_API_KEY` |
| **Competitor Research** | `competitor-research` | research / 10 | **live** | off | `#B58A3C` (amber) | `APIFY_TOKEN`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` |

Notes:
- All four are `perBrand: true`.
- **Brief Generation is the only placeholder** — it has no `Component`; its `/s/brief-generation` page renders the placeholder scaffold. The other three are wired live.
- The **`ops` group is declared in the type/registry but has no members** — `systemsByGroup()` filters it out, so "Operations" never appears in the nav today. (Gap / future slot, not dead code.)
- The Competitor Research `description` notably documents its code-native design: "Runs entirely in code (Apify + Gemini + Claude), no n8n."
- External providers implied by the live systems: **Anthropic Claude** (all live systems), **Kie AI** (Static = image generation, Video = Seedance video), **Apify** (Meta Ad scraper) and **Google Gemini** (vision) for Competitor Research, plus **Tavily** for competitor auto-discovery per its capabilities copy.

#### Infra readiness (`src/lib/infra.ts`)

Client-safe readiness computation against the `configuredKeys` set from `PortalMeta`:
- `infraReady(req, configured)` — **`n8n` kind always returns `false`** with the comment "this lab is n8n-free"; otherwise `configured.has(req.keyName)` (`infra.ts:7-10`).
- `infraStatus(reqs, configured)` — per-requirement `{ req, ready }`.
- `allInfraReady(reqs, configured)` — true if no reqs or all ready.
- `keysForSystem(systemKey)` and `systemsForKey(keyName)` — derive the key↔system mapping from the registry directly, "no separate table needed" (`infra.ts:23-40`).

---

### How Every Surface Renders From the Registry

#### Generic system route (`src/app/(portal)/s/[systemKey]/page.tsx`)

The single dynamic page that all systems route through:
1. Reads `params.systemKey`, `getSystem(key)`. If unknown → `EmptyState` (icon `PackageX`, "Unknown system", link back to dashboard) (`s/[systemKey]/page.tsx:19-32`).
2. If `system.status === "live" && system.Component && currentBrandId` → mounts the live component inside `<Suspense>` (animated skeleton fallback), passing `brandId={currentBrandId}` (`s/[systemKey]/page.tsx:35-42`).
3. Otherwise → `<PlaceholderState system={system} />`.

The header comment captures the contract: "When a system flips to 'live', its `Component` mounts here — no shell changes." `currentBrandId` comes from `useBrand()`, so a live system only mounts when a brand is selected.

#### Placeholder scaffold (`src/systems/_shell/placeholder-state.tsx`)

Rendered for placeholder systems (and live systems with no brand/component). It builds an entire "coming soon" page **from the registry fields**: an accent-tinted hero (`system.accent`, `system.name`, `system.description`, "Coming soon" badge), a "What it'll do" card listing `system.capabilities`, a "Setup" card with `<InfraChecklist infra={system.infra}>` and a Ready/Needs-setup badge from `allInfraReady`, a blurred "Interface preview" ghost mock, and a "modular slot" footer ("When it's built, it's live for every brand — no rewiring."). It also surfaces the current brand ("Will be tuned for …"). Copy explicitly notes "In the prototype, integrations are mocked."

#### Dashboard (`src/app/(portal)/dashboard/page.tsx`)

Client page reading `useBrand()` and `navSystems()`:
- Loading state: skeletons while `!isReady`. No-brand state: a centered "No brands yet" with "Add a brand" CTA (`dashboard/page.tsx:42-54`).
- Time-of-day greeting computed client-side (`dashboard/page.tsx:18-21`).
- **Hero** (`BentoCard.brand-wash`): shows `currentBrand.cluster`, greeting, brand name + tagline, `BrandMark`, and CTAs to `/brand-intelligence` and `/brands/new`.
- **Quick stats** (3 `StatCard`s): "Brands in workspace" = `brands.length`; "Systems available" = `navSystems().length`; "Enabled for this brand" = count where `enabledFor(key)` is true, with a `${liveCount} live` hint (`dashboard/page.tsx:24-27, 93-97`).
- `enabledFor(key)` resolves `currentBrand.enabledSystems[key]`, falling back to the registry's `enabledByDefault`, else `false` (`dashboard/page.tsx:24-25`) — i.e. per-brand enablement is stored on the brand, defaulted by the registry.
- **Systems grid** maps `navSystems()` → `<SystemCard system enabled={enabledFor(s.key)} />`.

#### System card (`src/components/shared/system-card.tsx`)

A registry-driven card: accent wash from `system.accent`, the system icon in an accent chip, a Live (`success`) vs "Coming soon" (`soon`) badge from `system.status`, name + tagline, and a footer status line computed from `usePortalMeta().configuredKeys`:
- **Off for this brand** (`Lock` icon) when `!enabled`;
- **"Needs <X, Y>"** (warning) listing the missing infra labels' first words when enabled but `!ready`;
- **"Ready to configure"** (success dot) when ready (`system-card.tsx:54-67`). The whole card links to `/s/{system.key}`.

#### Sidebar (`src/components/layout/portal-sidebar.tsx`)

The persistent left rail (`w-[268px]`, `bg-sidebar`). Composition:
- Wordmark + `BrandSwitcher`.
- **Base nav** (`BASE_NAV`, hard-coded): Dashboard, Brands, Onboarding, Brand Intelligence (`portal-sidebar.tsx:14-19`). **Admin** link appears only when `usePortalMeta().role === "admin"` (`portal-sidebar.tsx:50-54`) — the one role-gated nav item in the shell.
- **System groups** come from `systemsByGroup()`; each group prints its `NAV_GROUP_LABELS` label and its systems. Each system link shows a **"soon"** chip if `status === "placeholder"`, else an **amber dot** if `!allInfraReady(s.infra, configuredKeys)` ("Needs setup"), else nothing (`portal-sidebar.tsx:73-82`). Icons are tinted with `s.accent` when active.
- Active-state detection: `isActive(href)` matches exact path or prefix (system links match exact `/s/<key>`).
- Footer: a `⌘K` hint kbd + the `ThemeToggle`.

#### Command palette (`src/components/layout/command-palette.tsx`)

Global `⌘K`/`Ctrl+K` dialog (key listener toggles `open`, `command-palette.tsx:24-33`). Three groups:
- **Navigate** — Dashboard, Brands, Brand Intelligence, Add a brand (hard-coded).
- **Systems** — maps `navSystems()` → `router.push(\`/s/${s.key}\`)`, icon tinted by `s.accent`.
- **Switch brand** — maps `brands` → `setCurrentBrand(b.id)` with a `BrandMark`.

So the palette's "Systems" and "Switch brand" sections are fully registry/brand-store driven.

#### Brand switcher (`src/components/layout/brand-switcher.tsx`)

A dropdown in the sidebar. Reads `useBrand()`, **groups brands by `cluster`** (fallback "Other") into `DropdownMenuLabel` sections, each item a `BrandMark` + name + a check on the active brand. A bottom "Add a brand" item routes to `/brands/new`. Selecting an item calls `setCurrentBrand(b.id)`.

#### Brand store (`src/lib/brand-store.tsx`) — the brand-selection backbone

Although not strictly "auth", the shell depends on `BrandProvider`:
- On mount `refresh()` fetches `/api/brands` (Postgres-backed; localStorage is "UI convenience only, not authoritative", `brand-store.tsx:14`).
- `currentBrandId` resolution order: keep current if still valid → `localStorage["iterio-portal:current:v3"]` → first brand (`brand-store.tsx:43-48`).
- Persists the selected id to localStorage; sets a runtime **`--brand-tint`** CSS variable from the active brand's `brandColor` via `hexToHslTriplet` (`brand-store.tsx:72-75`) — this is what tints the per-brand wash across the shell.
- `addBrand` (POST), `updateBrand` (optimistic PATCH), `removeBrand` (optimistic DELETE), all against `/api/brands[/:id]`.
- `isReady` gates loading states across the shell.

---

### Design Language ("Soft Canvas")

The visual system is defined in `src/app/globals.css` and the root layout, and is consistently applied across these shell components.

- **Concept (per the CSS header comment):** "Warm / organic / friendly-premium. Cream paper, soft-espresso ink, sage primary, clay accent, warm forest sidebar. Nothing is pure black or pure white; every shadow is warm-tinted and low-contrast."
- **Type:** Fraunces (display, used with the `font-display` + `letterpress` treatment on headings), Hanken Grotesk (body), Spline Sans Mono (mono / kbd).
- **Palette (light, HSL tokens):** background cream `#F6F1E7`, card warm near-white, foreground soft espresso `#362F28`, primary sage `#5A7A64`, accent clay/terracotta `#C4775A`, plus `success`/`warning`/`destructive`. The **sidebar is a warm deep forest `#212B24`, explicitly "NOT black."**
- **Shape & depth:** large soft radius `--radius: 1.25rem` ("big, soft bento radius"), warm-tinted layered shadows (`--shadow-card`, `--shadow-card-hover`, `--shadow-elevated`), and an `--inner-light` top inner-highlight that creates the "pressed into paper" letterpress effect used on hero/login cards.
- **Theming:** dark mode is a `.dark` class on `<html>` driven by `next-themes` (`@custom-variant dark`), with a parallel deep-warm-clay token set. Tokens are mapped to Tailwind v4 utilities via `@theme inline` and the `@tailwindcss/typography` plugin is loaded.
- **Per-system accent:** each system carries its own warm-range hex (`accent`) used for icon chips, washes, and active sidebar icons.
- **Per-brand tint:** `--brand-tint` is overridden at runtime from the active brand color (the `brand-wash` class on dashboard/login heroes).
- **Shared primitives** that enforce the language: `PageHeader` (eyebrow + letterpress title + description + actions, `page-header.tsx`), `EmptyState` (dashed-border centered empty/error state, `empty-state.tsx`), `SystemCard`, and the `BentoCard` used throughout.
- **Login screen** reuses the same tokens: a `brand-wash` backdrop, a `Sparkles` brandmark chip, the letterpress wordmark, and a card styled with `var(--shadow-card), var(--inner-light)`.

---

### Current Status, Gaps & Notable Decisions

**Live / working:**
- App shell, route group, root layout, theme toggle, toaster — fully built.
- Magic-link auth end-to-end (login → `signInWithOtp` → `/auth/callback` → session cookie) and the edge middleware session gate.
- Role model: `requireAuth` / `requireAdmin` / `getCurrentProfile` with auto-provision + `ADMIN_EMAILS` admin upgrade; `/api/me` + `PortalMetaProvider` mirror.
- Registry-driven sidebar, dashboard, command palette, system cards, brand switcher, and the generic `/s/[systemKey]` renderer.
- Three live systems (Static, Video, Competitor Research) lazy-mount via the registry; Brief Generation renders the placeholder scaffold.

**Gaps / partial / things to flag (no invention):**
- **Brief Generation is still a placeholder** — `status: "placeholder"`, no `Component`, infra checklist mocked. It is the one "create" system not yet built, and it's the only system `enabledByDefault: true`.
- **The `ops` (Operations) nav group has no registered systems**, so it never appears — a declared-but-empty future slot.
- **`infra` requirements are visual/declarative only in this area.** Readiness drives badges (amber dot / "Needs X"), but the registry/infra layer does not itself block a live system from mounting — gating is each live component's own concern.
- **`n8n` infra kind is hard-coded `false`** by design ("this lab is n8n-free"). No system currently declares an `n8n` requirement, so this branch is effectively dormant.
- **Base nav links assume pages that aren't in this file set**: `/brands`, `/brands/new`, `/onboarding`, `/brand-intelligence`, `/admin`. They're referenced by the sidebar/command-palette/dashboard but their pages live outside the documented file list (not verified here).
- **`displayName` is plumbed but unused in the shell** — `/api/me` returns it and `Profile` carries it, but no shell surface renders it (the brand switcher/dashboard show brand names, not the user's display name).
- **Role gating in the shell is minimal** — only the **Admin** sidebar link checks `role === "admin"`. Page/route-level enforcement relies on `requireAuth`/`requireAdmin`/`getCurrentProfile` server-side, not on the client nav.
- **localStorage is explicitly non-authoritative** for both brand selection (`iterio-portal:current:v3`) and is only a convenience; the DB (`/api/brands`, `profiles`) is the source of truth.

**Notable design decisions:**
- The "registry as single source of truth" pattern: flipping a system live = set `status:"live"` + add a `Component` + add it to the `SYSTEMS` array; the shell needs zero changes (documented in `registry.ts` and `s/[systemKey]/page.tsx`).
- Middleware deliberately excludes `/api/` to avoid Next's 10 MB body buffering/truncation on multipart uploads, pushing API auth into handlers via `requireAuth()`.
- `ADMIN_EMAILS` (default `stephen@studio-flow.co`) is the durable admin source of truth, reconciled on every auth — consistent with the single-owner / many-brands model.

---

I now have everything needed. Here is the documentation section.

## Brand Onboarding & Brand Intelligence (B3) Foundation

### Purpose

This area is the **foundation layer of the entire Iterio portal**. Its job is to turn a handful of operator-supplied inputs (a website, a Meta Ad Library page, competitors, review-site URLs, a Reddit term, an Instagram profile, pasted marketing emails) into a single, **versioned, evidence-backed Brand Intelligence object called "B3"** that every downstream creative system (Static Ads, Video, Competitor Research, etc.) reads as its grounding source of truth.

The defining design idea: B3 is the **new canonical model**, but the portal's existing systems still read a **legacy flat brand model** (markdown sections, products, personas, USPs, palette, fonts). So when a B3 version is approved, the foundation **projects ("writes through")** the B3 into that legacy model, keeping every existing system working unchanged while new code reads B3 directly.

The whole research pipeline is **code-native** (no n8n): pending DB job rows are advanced by `after()`, a UI 4-second tick loop, and Vercel cron backstops; jobs are atomically claimed with `FOR UPDATE SKIP LOCKED`; async Apify scrapes are polled across passes using a custom `WaitError`; and all AI/scrape spend is metered to `usage_events` under the system key `brand-onboarding`.

---

### The three onboarding entry points (and an important split)

There are **two distinct onboarding flows** in this codebase, and they should not be confused:

1. **The legacy "Add a brand" wizard** at `/brands/new` (`src/app/(portal)/brands/new/page.tsx`) — a purely **client-side, prototype-grade** flow with three paths (`PathChooser`, `path-chooser.tsx`):
   - **research** — `ResearchFlow` (`research-flow.tsx`). This is a **mock/prototype**: `synthesizeFromResearch()` in `src/lib/onboarding/draft.ts` fabricates a believable draft locally from name+website using a deterministic palette (`pickPalette`) and canned section copy. The progress steps are timer-driven (`STEPS.forEach(... setTimeout(... (i+1)*620))`). The UI itself states "Prototype — synthesizes a believable draft locally."
   - **paste** — `PasteFlow` (`paste-flow.tsx`) splits a pasted markdown doc into typed sections via `parseMarkdownToSections()` (heading-based, `mapHeadingToType` regex rules).
   - **wizard** — `WizardFlow` (`wizard-flow.tsx`), a 3-step form (Basics → Market & voice → Substance) that builds sections/products/USPs from textareas.

   All three converge on `OnboardingReview` (`review.tsx`), then `create()`. **Key behavior:** if the chosen path is `research`, `create()` **strips all placeholder sections/products/personas/usps/competitors** (`const clean = { ...draft, sections: [], products: [], ... }`) and routes to `/onboarding` so the *real* B3 build happens there — i.e. the research path is just a clean brand-creation funnel into the real engine. The `paste` and `wizard` paths instead create a populated brand and go straight to `/dashboard`.

2. **The real B3 foundation workspace** at `/onboarding` (`src/app/(portal)/onboarding/page.tsx` → `OnboardingWorkspace`, `workspace.tsx`). This is the production engine described in the rest of this section, with steps **Inputs → Research → Review & edit → Approve**.

> **Gap / clarification:** The prompt frames "research/paste/wizard" as the three onboarding paths and "Inputs→Research→Review→Approve" as the wizard steps. In the actual code these are **two separate UIs**. The research/paste/wizard chooser is the prototype brand-creation funnel; the four-step Inputs→Research→Review→Approve flow is the real B3 engine. They are bridged only by the research path routing to `/onboarding`.

---

### The B3 object shape (`b3-schema.ts`)

`B3` is a deeply-optional TypeScript type (every field optional so partial drafts and the manual editor are always valid). Top-level keys:

| B3 key | Contents |
|--------|----------|
| `brand_snapshot` | `name`, `category`, `one_liner`, `mission`, `founder_story` |
| `positioning` | `statement`, `differentiators[]`, `category_belief`, `enemy`, `price_tier` |
| `personas[]` | `name`, `demographics`, `psychographics`, `jobs_to_be_done[]`, `pains[]`, `desires[]`, `objections[]`, `their_words[]` (verbatim VOC) |
| `emotional_triggers[]` | strings |
| `proof_mechanisms[]` | `type` (clinical/ingredient/social/founder/certification…), `detail`, `evidence` |
| `offers[]` | `name`, `pricing`, `subscription`, `promo` |
| `products[]` | `name`, `is_hero`, `ingredients[]`, `dosage`, `format`, `price`, `certifications[]`, `claims_made[]`, `image_keys[]` |
| `compliance` | `summary`, `rules[]` (`subject`/`jurisdiction`/`verdict`/`rationale`), `banned_phrasings[]`, `required_disclaimers[]` |
| `creative_dna` | `palette[]` (`hex`/`role`), `fonts` (`display`/`body`), `logo_key`, `visual_style`, `do[]`, `dont[]`, `reference_asset_keys[]` |
| `voice_profile` | `tone`, `vocabulary[]`, `sentence_style`, `banned_words[]`, `examples[]` |
| `winner_patterns` | `own[]`, `competitor[]`, `category[]` (each: `angle`/`hook`/`format`/`why_it_wins`/`source_ref`/`thumb_key`) |
| `gap_analysis` | `unmet_desires[]`, `whitespace_angles[]` |
| `channels[]` | `channel`, `notes`, `what_works` |
| `meta` | `confidence_scores` (field path → 0..1), `gaps[]` (`field`/`severity`/`reason`), `source_refs` (field path → refs), `version`, `generated_at` |

`B3_SECTIONS` enumerates the editor tabs; `blankB3(seed)` seeds a valid empty B3 (used for fresh drafts and as the synthesis base).

---

### Database tables (defined in `src/lib/db/schema.ts`, lines 595–747)

| Table | Role | Key columns |
|-------|------|-------------|
| `brand_sources` | One row per onboarding input | `type`, `url`, `handle`, `config` (jsonb, e.g. `{name, metaLibraryUrl, text, region, maxItems, scrapeJobId}`), `status` (`idle\|queued\|running\|complete\|failed\|partial`), `enabled`, `lastRunAt`, `lastError`. Unique on `(brandId, type, url)`. |
| `research_jobs` | One worker row per research stage (FSM mirroring competitor `scrape_jobs`) | `module`, `type` (`fetch\|extract\|delegated`), `status` (`pending\|running\|complete\|failed`), `provider`, `apifyRunId`, `apifyDatasetId`, `costCents`, `attempts`, `maxAttempts`, `error`, `meta`. |
| `raw_artifacts` | Raw scraped/fetched blobs (text inlined in `meta`, large blobs keyed to storage) | `kind` (`page\|ad\|review\|post\|transcript\|asset`), `storageKey`, `externalId`, `meta`. Unique on `(jobId, kind, externalId)`. |
| `extractions` | Structured AI extraction per source (current row per `(source, schemaType)`; re-run upserts) | `schemaType` (`website_intel\|voc\|email_intel\|compliance`), `json`, `confidence` (numeric 4,3), `model`. Unique on `(sourceId, schemaType)`. |
| `brand_assets` | Operator uploads + auto-pulled PDP images | `type` (`logo\|font\|palette\|brand_book\|product_photo\|packaging\|winning_creative`), `storageKey`, `meta`. Unique on `(brandId, storageKey)`. |
| `compliance_rules` | Brand-specific jurisdiction-aware ruleset | `subject`, `jurisdiction` (`US_FTC_FDA\|EU_EFSA_DSA`), `verdict` (`safe\|risky\|banned`), `rationale`, `evidenceSource`, `brandRunsThisClaim`, `confidence`. Unique on `(brandId, subject, jurisdiction)`. |
| `brand_intelligence` | **The B3** — versioned | `version`, `status` (`draft\|approved`), `json` (the B3), `confidenceJson`, `gapsJson`, `sourceRefsJson`, `approvedBy`, `approvedAt`. Unique on `(brandId, version)`. |

The pipeline also reuses the Competitor Research tables: `competitors`, `scrapeJobs`, `conceptClusters`, `angleBankEntries`.

---

### Source types: which run live vs delegate vs deferred

Defined in `pipeline.ts`:

| Source `type` | How it's handled | Module / provider |
|---------------|------------------|-------------------|
| `website` | **Live** internal extract | `runWebsiteJob` (Claude Sonnet + Tavily + Gemini vision) |
| `amazon`, `trustpilot`, `google_reviews` | **Live** internal extract | `runReviewsJob` (Apify review actor → VOC, Tavily fallback) |
| `reddit` | **Live** internal extract | `runRedditJob` (Apify Reddit actor → VOC) |
| `social` | **Live** internal extract | `runSocialJob` (Apify Instagram actor → VOC + brand voice) |
| `email` | **Live** internal extract | `runEmailJob` (Claude on pasted email text) |
| `compliance` | **Auto-created** internal extract (depends on website) | `runComplianceJob` (Gemini grounded + Claude structuring) |
| `meta_ads`, `competitor` | **Delegated** to the existing Competitor Research pipeline | `delegateScrape` → `startScrapeJob` (Apify Meta Ads) |
| `upload` (and any unknown type) | **Deferred** — set to `partial` with `lastError: "Module arrives in a later build"` | none (UI calls these "Later build"; `DEFERRED_SOURCE_TYPES = ["upload"]`) |

`LIVE_INPUT_TYPES` is the union of website + delegated + review types + reddit/social/email. `EXTRACT_MODULE` maps source type → internal module; `MODULE_PROVIDER` maps module → provider for the initial job row.

---

### The code-native job pipeline (`pipeline.ts`)

**Dispatch (`startOnboarding` → `dispatchSource`):**
- `startOnboarding(brandId)` loads enabled sources, dispatches each non-compliance source, and — if a `website` source exists — calls `ensureComplianceJob` to auto-create the compliance source + a pending Gemini job.
- `dispatchSource` deletes any prior jobs for the source, then: deferred types → `partial`; delegated types (`meta_ads`/`competitor`) → `delegateScrape`; otherwise sets the source `running` and inserts a `pending` `extract` job with the right provider.
- `delegateScrape` reuses/creates a `competitors` row (no duplication on re-run), then calls `startScrapeJob` in `url` mode (if a valid Meta Ad Library URL via `isAdLibraryUrl`) or `keyword` mode. It records the `scrapeJobId` into the source config and inserts a `delegated` job row.

**Atomic claim + run (`claimAndRunExtract`):** runs raw SQL:
```
UPDATE research_jobs SET status='running', attempts=attempts+1 ... WHERE id IN (
  SELECT id FROM research_jobs WHERE module IN (...) AND type='extract'
  AND status='pending' AND attempts < 3 ... ORDER BY created_at ASC LIMIT n
  FOR UPDATE SKIP LOCKED) RETURNING id
```
This is the concurrency-safe claim. For each claimed job it looks up the source, runs the `RUNNERS[module]` function, and on success attributes spend by summing `usage_events.costUsd` for `systemKey='brand-onboarding'` since `t0` (runners execute sequentially → a clean cost window) and writes it to `research_jobs.costCents`.

**Error handling on a claimed job** (the key gotcha logic):
- `WaitError` → set the job back to `pending` and **decrement attempts** (`Math.max(0, attempts-1)`) — i.e. **no attempt is burned** while waiting on a dependency or polling an async run.
- Transient errors (`isTransient`: Anthropic 429/5xx, or message matching connection/network/gemini-N patterns) → `pending`, attempts decremented, error stored.
- Otherwise → `failed` if `attempts >= MAX_ATTEMPTS` (3), else `pending`; on exhaustion the source is also marked `failed`.

**WaitError-based async Apify polling** (`wait-error.ts` + `voc-common.ts runApifyVocScrape`): the generic VOC runner is the heart of the async pattern.
1. First pass: if no `apifyRunId`, build the actor input, `startApifyRun`, persist `apifyRunId`/`apifyDatasetId` on the job, then **throw `WaitError`** (so it requeues without burning an attempt).
2. Later passes: `getApifyRun`; if `READY`/`RUNNING` → throw `WaitError` again; if `SUCCEEDED` → fetch dataset items, `recordApifyUsage`, normalize, store a `raw_artifacts` row, and run `extractVoc`; if any other status → return `false` so the caller falls back.
This lets a long async Apify scrape run inside an otherwise-synchronous extract pipeline, polled across multiple ticks/cron passes.

**Delegated advance (`advanceDelegated`):** for `delegated` jobs that are `running`, reads the linked `scrape_jobs.status` and mirrors `complete`/`error` onto both the job and the source.

**Synthesis trigger (`maybeSynthesize`):** only runs when **every** enabled source has settled (`complete\|failed\|partial`) and the latest B3's `meta.generated_at` is older than the newest source `updatedAt` (so it re-synthesizes on change but not redundantly). It then dynamically imports and calls `synthesizeB3`.

**Three execution drivers:**
| Driver | Function | Used by |
|--------|----------|---------|
| UI tick | `runOnboardingTick` = `advanceDelegated` + `claimAndRunExtract(limit 2)` + `maybeSynthesize` | `POST /api/brand-foundation/tick` (called every 4s by the workspace while jobs are active) |
| Cron poll | `pollDelegatedAll` | `GET /api/cron/research-poll` (`* * * * *`) |
| Cron extract | `extractAll` = `claimAndRunExtract(limit 4)` across all brands + per-brand `maybeSynthesize` | `GET /api/cron/research-extract` (`*/2 * * * *`) |
| Cron sweep | `sweepStuck` — fail jobs `pending\|running` and sources `queued\|running` older than 30 min | `GET /api/cron/research-sweep` (`*/15 * * * *`) |

All three crons are guarded by `assertCron(req)`.

---

### Research modules in detail

**Website (`modules/website.ts`, provider mix Claude+Tavily+Gemini):**
- Crawls the site (`crawlBrandSite`, up to 6 pages, 5K chars each), then — the standout feature — pulls the **Shopify `/products.json?limit=250` catalog** (`shopifyCatalog`) as the authoritative product list (Shopify `body_html` is usually empty of marketing copy).
- Tavily web research is enrichment and degrades gracefully if the key is missing.
- Claude Sonnet (`claude-sonnet-4-6`, max 2200 tokens) extracts structured intel via a forced tool call `emit_website_intel`.
- Catalog products are authoritative for the product LIST; Claude's per-product detail is overlaid by name; Claude-only products (bundles) are appended.
- **Ingredient-vision (the headline capability):** supplement-facts / ingredient panels live in **PDP label IMAGES**, not text. `pickLabelImages` orders images using a `LABEL_HINT` regex (`label|ingredient|facts|nutrition|supplement|panel|directions|back|spec`), `normMime` fixes Shopify mime quirks (never `image/jpg`), and `ingredientsFromImages` sends up to 2 images per product to **Gemini** (`callGemini` with `media`) to read ingredients+dosage as JSON. Products with a hinted image are processed first; a couple of non-hinted heroes get a best-effort pass. A **22-second wall-clock budget** (`visionDeadline`) governs the loop because the 60s tick route can claim this job — caps are `MAX_VISION_PRODUCTS=8`, `MAX_VISION_IMAGES=2`.
- Writes a `raw_artifacts` (kind `page`) row and an `extractions` row (`schemaType: "website_intel"`, model `claude-sonnet-4-6`).

**Reviews / VOC (`modules/reviews.ts`):** Preferred path is a dedicated **Apify review actor per site**, then VOC extraction; Tavily + page-fetch is the graceful fallback (writes `thinVoc` if nothing accessible). Chosen actor IDs:
| Site | Apify actor ID | Notes (from code comments) |
|------|----------------|------|
| Trustpilot | `6q70QEFc2Zk0ObldU` | automation-lab/trustpilot — 97% success, $0.25/1K |
| Amazon | `gFtgG31RZJYlphznm` | web_wanderer/amazon-reviews-extractor — 4.7★, 96% |
| Google Reviews | `Xb8osYTtOjlsgI6k9` | compass/Google-Maps-Reviews-Scraper — 44K users, 99% |
Reviews are normalized defensively (`normalizeReview` over many candidate keys since actor schemas vary), and a **deterministic rating distribution** is computed in code (`ratingDistribution`) rather than trusting the LLM. Confidence floor `0.85`.

**Reddit (`modules/reddit.ts`):** actor `trudax~reddit-scraper-lite` (note the `user~name` slug form the Apify client accepts). Searches `source.handle` (default brand name) across posts+comments for **unfiltered community VOC** (the code comment notes Reddit surfaces objections that star-reviews hide). Confidence floor `0.8`.

**Social (`modules/social.ts`):** actor `apify~instagram-scraper`. A single profile scrape yields the brand's **own captions (its voice)** plus **latestComments (audience VOC)**. Captions are surfaced to synthesis as `extra.voice_samples` to inform `voice_profile`. Confidence floor `0.8`.

**Email (`modules/email.ts`):** **paste-based** (you can't scrape an inbox). Operator pastes ≥40 chars into `config.text`; Claude Sonnet extracts brand-owned voice/offers via `emit_email_intel` (its own `schemaType: "email_intel"` — this is the brand's *own* marketing voice, not customer VOC). Short/empty text records a thin extraction.

**Compliance (`modules/compliance.ts`):** auto-created, **depends on the website extraction**. If `website_intel` isn't ready and the website source is still in flight, it **throws `WaitError`** to retry next pass. Collects up to 25 claims+ingredients, then: (1) **Gemini search-grounded** (`grounded: true`) regulatory research across US FTC/FDA + EU EFSA/DSA; (2) Claude Sonnet structures it into rules via `emit_compliance` (conservative: default `risky`). Upserts `compliance_rules` (cross-referencing claims the brand already runs as `brandRunsThisClaim`) and an `extractions` row (`schemaType: "compliance"`, model `gemini+claude`).

**VOC shared layer (`modules/voc-common.ts`):** holds `scrubPII` (strips emails/phones/handles, keeps wording), defensive `pick`/`normalizeReview` helpers, the `emit_voc` tool (verbatim phrases, before/after, objections, desires, pains, persona signals), `extractVoc` (upserts `schemaType: "voc"` with a confidence floor and `source_kind` of `apify_scrape` vs `web_research`), `thinVoc`, and `runApifyVocScrape` (the async-Apify engine described above).

---

### Synthesis (`synthesis.ts`)

`synthesizeB3(brandId)` aggregates **all extractions** for the brand plus **winner signals** from the reused competitor pipeline (`conceptClusters` ordered by `winnerScore`, joined to `angleBankEntries`, split into `winners_own` vs `winners_competitor`). It calls **`claude-opus-4-8`** (max 10K tokens, 180s timeout, **no `temperature`** — Opus 4.8 rejects it) with a system prompt that supplies a `B3_SHAPE` template and rules ("ground every field; copy customer wording verbatim into `personas.their_words`; never invent; produce `meta.confidence_scores` per section and `meta.gaps`"). Output is parsed by `parseJsonObject` (strips fences, slices between braces).

Deterministic post-processing (not trusted to the LLM):
- Ensures `brand_snapshot.name/category` and a `meta` block; if parsing failed, injects a high-severity "review and fill manually" gap.
- **`meta.source_refs`** is built deterministically — mapping each B3 section to the `extractions` (by `schemaType`) that fed it (e.g. `personas` ← all `voc` sources + website; `compliance` ← `compliance`).
- **Compliance rules are folded in from `compliance_rules`** directly, so they're never lost to LLM paraphrasing.
- Always calls `createDraft` → a brand-new draft version (idempotent; never overwrites).

---

### Versioning, write-through, approval, diff

**Versioning (`versioning.ts`):**
- `ensureDraft` returns the latest version or seeds a v1 draft from the brand.
- `createDraft` makes a new version (`max(version)+1`), copying `meta` confidence/gaps/source_refs into the dedicated columns.
- `saveDraftJson` updates a **draft** version only (no-op on approved — the optimistic guard in the API returns 409).
- `approveVersion` sets status `approved` + `approvedBy`/`approvedAt`, then calls `projectB3ToLegacy`.
- `listVersions` returns history desc.

**The stable grounding contract (`contract.ts`):** `getApprovedBrandIntelligence(brandId)` returns the latest **approved** B3 (or null) — the function new downstream code is meant to call. `getLatestBrandIntelligence` returns the latest row (draft or approved) for the workspace.

**Write-through projection (`writethrough.ts`):** `projectB3ToLegacy` maps B3 into legacy `intelligence_sections` (identity, audience, products, usps, voice, visual, competitors, **constraints** — the last reads as `sectionType: "constraints"` which static generation consumes), plus `products`/`personas`/`usps` rows, `palette`+`brandColor`, and `fonts`, via `updateBrandRecord`. **Notable safety:** products are merged by name against existing products so **uploaded media (image/video URLs) is never wiped**; competitors are intentionally *not* array-replaced (the competitor-research system owns that table).

**Diff (`b3-diff.ts` + `version-diff.tsx`):** `diffB3` flattens both B3 objects to leaf paths and reports added/removed/changed, **skipping machine churn** (`meta.generated_at|version|source_refs|confidence_scores`). `VersionDiff` is a client component with two version selectors, +/−/~ counts, and a per-section grouped, truncated diff view. Shown on the Approve step when ≥2 versions exist.

---

### UI surfaces

**Workspace (`workspace.tsx`)** — four pill-steps **Inputs → Research → Review & edit → Approve**. It loads sources/jobs (`/status`) and the current B3 (`/b3`), and runs a **4-second `setInterval` tick loop** (`pump`) whenever any job is `pending\|running`, guarded by an `inFlight` ref so a ~30s synthesis tick never overlaps. If the latest row is `approved`, it jumps to the Approve step. "Edit → new draft" calls `/b3/draft`.

- **StepInputs (`step-inputs.tsx`):** forms for Website, Meta Ad Library URL, repeatable Competitors (name/website/Meta library URL), repeatable Review sources (Amazon/Trustpilot/Google picker + URL), Reddit search term, Instagram URL, and a Marketing-emails textarea (≥40 chars). "Save inputs" or "Save & run research" PUTs to `/sources` and (on the latter) kicks `/research/start`.
- **StepResearch (`step-research.tsx`):** a live per-source status grid (icons, status badges, per-job cost, View + Re-run buttons), a settled/partial summary bar with total cost, "Synthesize B3 now" (enabled once any source is complete), and "Review B3" (once a draft exists). The **ExtractionViewer** dialog shows Structured (the extraction JSON) and Raw (Tavily answer + page text) tabs via `/sources/[id]/extraction`.
- **B3Editor (`b3-editor.tsx`):** 13 tabs (Snapshot, Positioning, Personas, Triggers, Proof, Offers, Products, Voice, Creative DNA, Winners, Compliance, Channels, Gaps). Per-section **confidence badges** (`confidenceMeta`: ≥0.8 High / ≥0.5 Medium / else "Low — verify"), a **gaps banner**, and inline editing that commits a whole section on blur via `PATCH /b3` (path-based). Object-array sections (personas, offers, products, winners, channels) use the `ObjArray` editor. The Creative DNA tab embeds the **AssetUploader**. Read-only when the version is approved.
- **StepApprove (`step-approve.tsx`):** version+status badge, a gap count warning ("you can approve anyway"), a confirm dialog → `POST /approve`, and a Version history panel with a Compare toggle (`VersionDiff`).
- **AssetUploader (`asset-uploader.tsx`) + ASSET_SLOTS:** Logo, Brand book (PDF), Fonts, Product photos, Past winning creatives — multipart upload to `/assets` (server allows `logo|font|palette|brand_book|product_photo|packaging|winning_creative`, max 50MB), thumbnails with signed URLs, delete.

**Brand Intelligence page (`brand-intelligence/page.tsx`):** displays the **legacy projection** (the result of write-through) as tabs (Intelligence sections, Products with signed 1:1 + 9:16 media that self-heal on expired-URL `<img>` errors, Audience, USPs, Competitors, Identity/palette). A banner links to `/onboarding` ("Open foundation") and explicitly states "these sections are its projection." Section editing here writes back to the brand via `useBrand().updateBrand`.

**Brands list/detail (`brands/page.tsx`, `brands/[slug]/page.tsx`):** brand cards and a detail page with system-enablement toggles and an intelligence snapshot. The detail page's "Remove brand" dialog still says "prototype — stored locally," which is **stale copy** given the Postgres backend.

---

### API routes & cron summary

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/brand-foundation/sources` | GET / PUT | List / replace a brand's inputs (dedupe, drop blanks) | viewer blocked on PUT |
| `/api/brand-foundation/research/start` | POST | Kick `startOnboarding` detached via `after()`, returns 202 | viewer blocked |
| `/api/brand-foundation/tick` | POST | `runOnboardingTick` (UI 4s loop), `maxDuration=60` | viewer blocked |
| `/api/brand-foundation/status` | GET | Sources + jobs for the grid | any auth |
| `/api/brand-foundation/synthesize` | POST | Force `synthesizeB3` detached | viewer blocked |
| `/api/brand-foundation/b3` | GET / PATCH | Latest/specific version (auto-seeds v1 draft) / path-patch a draft (409 if approved or stale) | viewer blocked on PATCH |
| `/api/brand-foundation/b3/draft` | POST | New editable draft from latest ("Edit after approve") | viewer blocked |
| `/api/brand-foundation/approve` | POST | `approveVersion` + write-through, `maxDuration=60` | viewer blocked |
| `/api/brand-foundation/versions` | GET | Version history | any auth |
| `/api/brand-foundation/assets` | GET / POST / DELETE | List (signed URLs) / upload / delete brand assets | viewer blocked on writes |
| `/api/brand-foundation/sources/[id]/rerun` | POST | `rerunSource` detached | viewer blocked |
| `/api/brand-foundation/sources/[id]/extraction` | GET | Structured + raw artifact for the viewer | any auth |
| `/api/cron/research-poll` | GET | `pollDelegatedAll` — `* * * * *` | `assertCron` |
| `/api/cron/research-extract` | GET | `extractAll` — `*/2 * * * *`, `maxDuration=120` | `assertCron` |
| `/api/cron/research-sweep` | GET | `sweepStuck` — `*/15 * * * *` | `assertCron` |
| `/api/brands` | GET / POST | List / create brand (`createBrandFromDraft`) | viewer blocked on POST |
| `/api/brands/[id]` | PATCH / DELETE | Update brand / delete (**admin only** for DELETE) | role-gated |
| `/api/brands/[id]/product-media` | GET | Fresh signed product image URLs (1:1 + 9:16) keyed by product id | any auth |

Cron schedules are confirmed in `vercel.json`.

---

### External providers / models

| Provider | Where | Model / actor |
|----------|-------|---------------|
| Anthropic Claude | website, email, compliance-structuring, VOC extraction | `claude-sonnet-4-6` (tool-forced) |
| Anthropic Claude | B3 synthesis | `claude-opus-4-8` (10K tokens, 180s, no temperature) |
| Google Gemini | ingredient-vision (PDP label images) + compliance grounded research | `callGemini` (`media` + `grounded:true`) |
| Tavily | website + reviews enrichment/fallback | `tavilySearch` (advanced depth) |
| Apify | reviews, reddit, social scrapes (async) + delegated Meta Ads via Competitor Research | actor IDs listed above; `APIFY_TOKEN` via `getApiKey` |

All spend metered to `usage_events` under `systemKey: "brand-onboarding"` (plus `recordApifyUsage` for scrapes).

---

### Current status: live / partial / placeholder / gaps

**Fully implemented & wired (per code + MEMORY note that it was E2E-verified on "Happy Mammoth"):**
- The complete code-native pipeline: dispatch, atomic claim (`FOR UPDATE SKIP LOCKED`), WaitError async-Apify polling and dependency-wait, synthesis with Opus, write-through projection, versioning, approve, version-diff, assets, and all API routes + crons.
- All live modules: website (incl. Shopify catalog + Gemini ingredient-vision), reviews (3 sites), reddit, social, email, compliance.
- Delegation of `meta_ads`/`competitor` to the existing Competitor Research pipeline.

**Partial / placeholder / gaps:**
- **The `/brands/new` research path is a prototype** — `synthesizeFromResearch` fabricates content locally; `ResearchFlow`'s progress bar is timer-based; the UI itself says so. The real research only happens after the brand lands in `/onboarding`. This is the main "looks like a feature but is mock" risk for a stakeholder.
- **`upload` source type is deferred** ("Module arrives in a later build" → `partial`); the asset-upload UI exists but there is no auto-extraction from uploaded brand books/creatives into B3.
- **B3 fields not populated by the engine:** `personas.jobs_to_be_done`, `proof_mechanisms`/`offers` source linkage, `creative_dna.logo_key`/`reference_asset_keys`/`fonts`/`palette` (synthesis prompt's `B3_SHAPE` omits creative_dna palette/fonts/logo), `products.image_keys`, and `winner_patterns.category`/`format`/`source_ref`/`thumb_key`. These are editable in the UI but not auto-filled — palette/fonts still come from the legacy onboarding/brand record, not from research.
- **Schema/comment drift:** `research_jobs.module` comment lists `assets` as a module but there is no assets runner; `brand_assets.type` and the assets route allow `palette`/`packaging` types not present in the UI's `ASSET_SLOTS`.
- **Stale UI copy:** the brand detail "Remove brand" dialog claims data is "stored locally (prototype)," which is inaccurate given the Postgres-backed model.
- **Cost attribution caveat (by design, noted in code):** per-job `costCents` is computed by summing usage in a time window since runners execute sequentially; concurrent runs (e.g. cron `limit 4` across brands) could in principle blur attribution, though the brand filter narrows it.

**Notable design decisions / gotchas worth flagging:**
- `WaitError` deliberately **decrements attempts** so dependency-waits and async polls never exhaust the retry budget.
- The website ingredient-vision loop is bounded by a **hard 22s wall-clock** so a 60s tick route can safely claim it.
- Synthesis builds `source_refs` and folds `compliance_rules` **deterministically** rather than trusting the LLM.
- Write-through **never wipes uploaded product media** and **never replaces competitors**.
- Approve is the only thing that updates the legacy model, so downstream systems only ever see operator-approved B3.

---

I have everything needed. Here is the documentation section.

## Competitor Research System

### Purpose

The Competitor Research System is Iterio's **competitive creative radar**. For any brand, it scrapes a competitor's live Meta (Facebook/Instagram) ads, owns the media, uses AI to deconstruct each ad into a reusable strategic teardown, clusters near-duplicate variants into "concepts," ranks each concept by a composite **Winner Score**, tracks week-over-week (WoW) momentum, and then lets the user **Remake** any winner by handing a pre-filled, on-brand prompt into the Static or Video Generation systems. It runs **entirely in code** — Apify (scraping) + Google Gemini (vision) + Anthropic Claude (strategy) — with **no n8n**, following the portal's pending-row → cron + UI-tick async pattern, atomic `FOR UPDATE SKIP LOCKED` claims, and `recordUsage`-based spend metering.

The system definition lives in `src/systems/competitor-research/index.ts`: `key: "competitor-research"`, `status: "live"`, `perBrand: true`, `enabledByDefault: false`, nav group `"research"` order `10`, accent `#B58A3C`. It declares three infra dependencies the brand must have configured: `APIFY_TOKEN` (service), `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY` (API keys). The component is lazy-loaded.

### High-Level Pipeline

A scrape produces a `scrape_jobs` row that walks a status machine, driven by **both** a UI 4s tick loop (while the page is open) and Vercel crons (the always-on backstop):

```
pending → running → ingesting → analyzing → scoring → complete   (or → error)
```

| Stage | Driver function | File | What happens |
|-------|-----------------|------|--------------|
| start | `startScrapeJob` | `scrape-job.ts:22` | Resolve URL, fire Apify actor, insert `scrape_jobs` (pending) |
| pending→running→ingesting | `pollAndIngestJob` | `ingest.ts:320` | Poll Apify run; on SUCCEEDED, normalize + dedup + capture media into Storage |
| ingesting→analyzing | (within ingest) | `ingest.ts:382` | When the final batch ingests cleanly, record Apify cost and flip to `analyzing` |
| analyzing→scoring | `analyzeQueued` → `completeFinishedJobs` | `analyze.ts:280`, `analyze.ts:348` | Gemini vision + Claude teardown per ad; when no retryable ad remains, flip job to `scoring` |
| scoring→complete | `scoreAnalyzedJobs` → `scoreJob` → `clusterRun` | `scoring-run.ts:126`, `scoring-run.ts:14`, `cluster.ts:68` | Cluster variants, compute Winner Score, upsert Angle Bank, mark `complete` |

### DB Tables (all in `src/lib/db/schema.ts`)

| Table | Role | Notable columns |
|-------|------|-----------------|
| `competitors` (`:128`) | Tracked competitor sources, per brand | `metaLibraryUrl`, `metaPageId`, `metaSearchTerms`, `country`, `niche`, `isActive`, `radarEnabled`, `lastScrapedAt` |
| `scrape_jobs` (`:195`) | Async pipeline backbone | `status`, `mode`, `query`, `country`, `requestedCount`, `niche`, `apifyRunId`, `apifyDatasetId`, `stats` (adsFound/adsAnalyzed/conceptsScored), `costUsd`, `errorMessage` |
| `competitor_ads` (`:228`) | One row per scraped ad | identity (`adArchiveId`, `adGroupId`, `collationId`, `competitorPageId`), media paths (`primaryThumbnail`, `videoPath`, `mediaCards`, `mediaCardItems`, `fullMediaAsset`), `mediaCaptureFailed`/`mediaCaptureAttempts`/`sourceMediaUrls`, copy fields, 9 AI analysis fields + richer teardown (`awarenessLevel`, `emotionalDriver`, `secondaryDrivers`, `beatStructure`, `nativeScore`, `complianceFlags`), activity (`stillActive`, `firstSeenActive`, `lastSeenActive`, `resurrected`), `conceptId`, queue state (`aiAnalysisStatus`, `aiAttempts`, `aiLastAnalyzedAt`, `aiErrorMessage`). Unique index `(brandId, adArchiveId)`. |
| `concept_clusters` (`:315`) | Variant grouping + score, one row per `(brandId, conceptKey)` | `conceptKey`, `clusterMethod`, `representativeAdId`, `activeVariantCount`/`totalVariantCount`, `distinctFormats`/`formats`, `firstSeen`/`lastSeenActive`/`activeDays`/`peakActiveDays`, `stillActive`/`resurrected`, `winnerScore`/`winnerTier`/`confidence`, `countHistory` (WoW time series), `lastScoredRunId`. EU-reach columns (`euTotalReach`, `euReachPerDay`) exist but are **null in v1**. |
| `angle_bank_entries` (`:363`) | Structured teardown per concept (research output + remake input) | `angle`, `hook`, `mechanism`, `offer`, `awarenessLevel`, `emotionalDriver`, `beatStructure`, `nativeScore`, `complianceFlags`, denormalized `winnerScore`/`winnerTier`/`signals`/`confidence`, curation `status` (`raw`/`approved`), `usedInGenerations`. Unique index on `conceptId`. |
| `swipe_library` (`:417`) | Saved/curated winners; compounds per niche | `angleBankEntryId`, `conceptId`, `niche`, `tags`, `note`, `snapshot` (jsonb, survives concept deletion), `savedBy` |
| `usage_events` (`:170`) | Unified spend metering | written via `recordUsage`/`recordApifyUsage` with `systemKey: "competitor-research"` |

### API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/systems/competitor-research/sources` | GET/POST/PATCH/DELETE | List/add/edit/delete competitors. POST validates the Meta URL via `isAdLibraryUrl`; PATCH whitelists fields including `isActive`, `radarEnabled`, `niche`. |
| `/api/systems/competitor-research/scrape` | POST | Manual scrape via `startScrapeJob`; returns `202 {jobId, status:"pending"}`. URL-validation errors → 400, Apify start failures → 502. |
| `/api/systems/competitor-research/discover` | POST | Tavily discovery Phase 1 (`discoverCandidates`); `maxDuration=120`. Requires a `TAVILY_API_KEY` or returns a 400 telling the user to add one. |
| `/api/systems/competitor-research/discover/scrape` | POST | Discovery Phase 2 (`scrapeSelectedCompetitors`); persists chosen competitors + fans out scrapes. `maxDuration=120`. 502 if `jobsStarted === 0`. |
| `/api/systems/competitor-research/jobs` | GET | Latest 10 jobs + latest 60 ads, each ad's media paths re-signed into URLs. |
| `/api/systems/competitor-research/tick` | POST | UI-driven pipeline step: polls active jobs, `analyzeQueued({brandId, limit:4})`, `scoreAnalyzedJobs(brandId)`. `maxDuration=60`. |
| `/api/systems/competitor-research/concepts` | GET | Up to 200 scored concepts (Winner Board) + a `momentum` slice; joins Angle Bank, representative-ad thumbs, and variant ad ids. |
| `/api/systems/competitor-research/swipe` | GET/POST/DELETE | The swipe library: list/save/delete saved winners (one per concept per brand). |
| `/api/systems/competitor-research/remake` | POST | Build the on-brand remake prefill (Static or Video). `maxDuration=120`. |
| `/api/systems/competitor-research/ad/[id]/media` | GET | Re-sign one ad's media URLs (called on `onError`, since signed URLs expire after ~1h / `expiresIn=3600`). |

All routes use `requireAuth`; every mutating route hard-blocks the `viewer` role with 403.

### Cron Jobs (`vercel.json`)

| Cron | Schedule | Handler | Function |
|------|----------|---------|----------|
| `/api/cron/poll-runs` | `* * * * *` (every minute) | `poll-runs/route.ts` | `pollAndIngestJob` over up to 10 active jobs |
| `/api/cron/analyze` | `*/2 * * * *` | `analyze/route.ts` | `analyzeQueued({limit:6})` (global, no brand scope) |
| `/api/cron/score` | `*/2 * * * *` | `score/route.ts` | `scoreAnalyzedJobs()` (global) |
| `/api/cron/sweep-stuck-jobs` | `*/15 * * * *` | `sweep-stuck-jobs/route.ts` | Times out jobs stuck >30 min → `error`; requeues ads stuck `processing` >15 min (hands back the attempt); reconciles `queued`-at-cap → `failed` |
| `/api/cron/radar` | `0 9 * * 1` (Mondays 09:00) | `radar/route.ts` | Weekly radar: ages out stale ads + re-scrapes pinned competitors |

All crons are protected by `assertCron(req)`. The UI tick (`component.tsx:80`) is the foreground twin: while a job is active it `POST`s `/tick` on a leading call + 4s interval, then reloads jobs/ads/concepts.

---

### Feature 1 — Tavily Auto-Discovery (semi-manual, four steps)

The "Discover competitors" card (`competitors-tab.tsx:141`) implements a deliberately **two-phase, human-in-the-loop** flow so the user never blindly scrapes 12 competitors:

1. **Discover** — User types a brand name, domain, or Meta Page URL → `POST /discover`. Server runs `discoverCandidates` (`discover.ts:79`): a Tavily advanced search (`tavilySearch`, `searchDepth:"advanced"`, `includeAnswer:true`, max 10 results, 9000-char context cap) → Claude `claude-sonnet-4-6` with the `emit_competitors` tool returns the brand's `niche` + 8–12 **direct** competitors (retailers/marketplaces/publishers/the seed brand explicitly excluded). Candidates are deduped by name + cleaned domain, Meta URLs validated, capped at `MAX_COMPETITORS = 12`.
2. **Pick** — Candidates render as a checklist (default all selected). Each shows a `Meta page`/`keyword` badge and clickable domain.
3. **Per-competitor ad count** — Each row has its own ads dropdown (`AD_COUNTS = [10,20,30,50,100]`); the footer tallies "N selected · M ads total."
4. **Scrape** — "Scrape N selected" → `POST /discover/scrape` → `scrapeSelectedCompetitors` (`discover.ts:105`): persists each chosen competitor into `competitors` (with niche, `type:"Direct"`), then `Promise.allSettled` fans out one `startScrapeJob` each — by valid Meta URL if available, else **keyword by name**. Returns `jobsStarted`.

**Status: live.** Gap: it relies on Claude correctly guessing competitors and rarely returns a precise `metaPageUrl`, so most discovered competitors are scraped by keyword (less precise than a real Ad Library URL).

### Feature 2 — Meta Ad Scraping (Apify ingest + media capture)

**Three input modes** (Ad Library tab, `library-tab.tsx:42`): `url` (paste a `facebook.com/ads/library/?…` link — most reliable), `page_id`, or `keyword`. `meta-url.ts` resolves the actual scrape URL (`resolveScrapeUrl`) and validates pasted URLs (`isAdLibraryUrl` — https + `*.facebook.com` + `/ads/library` path). The actor is **curious_coder's Facebook Ads Library Scraper**, `META_ADS_ACTOR_ID = "XtaWFhbtfxyzqrFmd"` (`meta-url.ts:6`).

`startScrapeJob` (`scrape-job.ts:22`) clamps the count to 1–100, fires Apify with `count`, `scrapeAdDetails:true`, `urls`, `scrapePageAds.activeStatus:"active"`, `scrapePageAds.countryCode`, then inserts the `scrape_jobs` row and stamps `lastScrapedAt` on the competitor.

**Ingest** (`pollAndIngestJob`, `ingest.ts:320`):
- Polls `getApifyRun`; RUNNING/READY → `running`; FAILED/ABORTED/TIMED-OUT → `error`; only SUCCEEDED proceeds.
- `listApifyDataset` (count + 10), each item run through `normalizeMetaAd` (`ingest.ts:66`) which defensively reads many alias keys (`adArchiveID`/`ad_archive_id`/…), determines `mediaType` (video / carousel — `cards.length >= 2` or `display_format` CAROUSEL/DPA / image / text), and extracts ordered `carouselCards` (each can be image AND/OR video, capped at `MAX_CARDS = 10`).
- **Bounded `PER_PASS = 6`** ads ingested per pass (videos are heavy; keeps a pass under `maxDuration`). Dedup is by `(brandId, adArchiveId)`: re-seen ads bump `dedupCount`, refresh `lastSeenActive`, backfill `firstSeenActive`, and **opportunistically backfill media** on re-scrape (re-captures when `mediaCaptureFailed` OR the row has no stored media but the new scrape carries URLs, capped at 3 attempts — this heals rows from older logic, e.g. DCO video carousels). A previously-failed analysis is re-queued once media is present.
- **Media capture** (`captureMedia`, `ingest.ts:175`): downloads poster + the full video + **every carousel card (image and video)** to Supabase Storage (`scraped-meta-ads/`), `IMG_MAX = 25MB` / `VID_MAX = 200MB`, with per-fetch timeouts. Carousels reuse the first card's media for poster/video (no duplicate fetch). Completeness is checked and `mediaCaptureFailed` set accordingly.
- The job only advances to `analyzing` when the final batch ingests with zero failures; on completion it calls `recordApifyUsage` (cost from `run.usageUsd`) and writes `stats.adsFound`. Failed inserts leave no row, so they reappear next pass and retry.

**Status: live.** Carousel multi-slide capture and the backfill/heal path are implemented and battle-tested.

### Feature 3 — Gemini Vision + Claude Teardown (analysis)

`analyzeQueued` (`analyze.ts:280`) is the atomic-claim worker:
- **Reconcile** stranded `queued`-at-`MAX_ATTEMPTS` (3) ads → `failed`.
- **Atomic claim**: a raw `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` flips `queued`→`processing` and increments `aiAttempts` in one statement, so the cron and the UI tick can never grab the same rows (no double-spend).
- `brandId` scopes the UI tick's claim; the cron runs global. Default `limit` 6 (tick passes 4).

Per ad (`analyzeOne`, `analyze.ts:165`):
- **Gemini** (`gemini-2.5-flash`) does the vision pass. Carousels send every card poster + the first card's video in one call (`carouselMedia`, budget `MAX_INLINE_TOTAL = 16MB`, `MAX_INLINE_VIDEO = 14MB`). Plain videos under 14MB are analyzed for hook/scene/verbatim transcript; otherwise it falls back to poster-frame image analysis.
- **Claude** (`claude-sonnet-4-6`) is forced to call the `emit_ad_analysis` tool, producing the structured teardown: `creative_angle`, `target_persona`, `core_motivation`, `proof_mechanism`, visual/spoken hooks, `outro_offer`, transcript, plus the richer **Angle Bank** fields — Eugene-Schwartz `awareness_level`, `emotional_driver` (+ secondary), an ordered `beat_structure`, a `native_score` (0–1 organic-ness), and `compliance_flags`. The brand brief (top 2 intelligence sections) is injected for context.
- **Transient errors** (`isTransient`: connection errors, 429, 5xx) hand the attempt **back** (decrement `aiAttempts`) rather than burning retry budget; hard errors at the cap → `failed`.
- `completeFinishedJobs` (`analyze.ts:348`) flips a job `analyzing`→`scoring` once no retryable ad remains, forcing leftover stuck rows to `failed` first.

**Status: live.** All AI calls record usage with `systemKey: "competitor-research"`. Constraint: Gemini's inline request budget caps video analysis at ~14MB; larger videos degrade to poster-only.

### Feature 4 — Concept Clustering

`clusterRun` (`cluster.ts:68`) is fully **idempotent** (recompute-from-state, never increment). The concept key (`conceptKey`, `cluster.ts:32`) prefers Meta's own `collation_id`, then `ad_group_id`, then a stable FNV-1a hash of normalized primary/headline text. It aggregates across the **full ad set of every competitor page** the run touched (not just this run's ads), upserts `concept_clusters` by the unique `(brandId, conceptKey)`, picks the representative ad (newest-analyzed, else newest snapshot), links member ads' `conceptId`, and returns aggregated signals (active/total variant counts, distinct formats, active days, peak active days, still-active, resurrected).

**Status: live.**

### Feature 5 — Winner Scoring + Tiers

`scoring.ts` holds pure (no-DB) scoring math. `computeConceptScore` (`scoring.ts:43`) blends four normalized components with weights `{longevity:0.3, scaling:0.35, reachVel:0.2, spread:0.1}`:
- longevity = activeDays/90, scaling = activeVariantCount/12, spread = distinctFormats/4, reachVel = euReachPerDay/50000.
- **EU reach is null in v1** (no Meta API yet), so the reach term is dropped and the remaining weights renormalize to 0.75; confidence is capped at "medium." A `RELAUNCH_BONUS = 0.1` is added for resurrected concepts, then an exp recency decay over 30 days, → score 0–100.
- `assignTier` (`scoring.ts:76`): highest-priority match of `proven_control` 🏆 / `scaling_now` 🔥 / `in_testing` 🧪 / `historical_swipe` 📚 (thresholds in `TIER`).
- `confidence` is high/medium/low from how many of {≥30 active days, ≥3 variants, ≥2 formats} hold.

`scoreJob` (`scoring-run.ts:14`) computes `variantDeltaWoW` from the prior run's `countHistory` entry, writes score/tier/confidence + an idempotent (run-guarded) `countHistory` append, then upserts the `angle_bank_entries` row — deliberately **excluding** `status` and `usedInGenerations` from the update `set` so an approved curation is never clobbered. On a hard error it still marks the job `complete` so the board shows the analyzed ads.

**Status: live, but v1.** Known gap: the reach-velocity term and the high-confidence path are dormant pending a real Meta reach feed.

### Feature 6 — Winner Board UI

`winner-board-tab.tsx` is the default tab. It renders:
- A **Momentum row** ("New & scaling this week") of horizontally-scrolling cards (`momentum`, computed server-side: `isNewThisWeek` or `wowDelta > 0`, top 12 by score).
- A filter/sort bar: search (angle/hook/mechanism/advertiser), tier chips, format chips, and sort by Top score / Most variants / Longest active.
- A grid of **WinnerCards**: thumbnail + tier badge + `ScoreBadge` (with a confidence-colored dot), advertiser, signal chips (`×N live`, `Nd active`, `+N wk` momentum, emotional driver, awareness level), an expandable **Teardown** (angle/hook/mechanism/offer/beats/compliance flags), and footer actions: **Remake** dropdown, **Save to swipe** bookmark, and **Variants**.
- "View variants" drills into the raw ad via the shared `AdDetailModal` (`onViewVariants`, `component.tsx:131`).

**Status: live.**

### Feature 7 — Ad Library UI + Ad Detail Modal

`library-tab.tsx` is the "Ad Library" tab: the quick-scrape form (3 modes + country + ads-to-scrape) plus a filterable/sortable grid of `AdCard`s. Cards show longevity badge, dedup count, analysis status (`analyzing…` / `analysis failed`), and a "media unavailable" badge; on a thumbnail load error they auto re-sign once via `/ad/[id]/media`.

`ad-detail-modal.tsx` is a two-pane dialog. **Left**: media viewer that steps through ALL carousel slides (per-card image and/or video via `cardItems`), plays video, or shows text; on media error it does a one-shot re-sign. **Right**: structured detail — Strategy (audience/motivation/proof), Hooks (visual/spoken), Closing offer, collapsible Transcript, Funnel & Copy (headline/copy/CTA/landing/DCO), platform list, Ad Library link, and Download.

**Status: live**, with two **placeholder** actions: `DeferredAction` chips "Save to Winners" ("Coming with the Winners library") and "Generate Brief" ("Coming with Brief Generation") are disabled tooltips — dead/aspirational UI.

### Feature 8 — Competitors Tab + WoW Momentum + Weekly Radar

`competitors-tab.tsx` hosts auto-discovery (above) plus manual add-by-Meta-URL, a shared ads/scrape count selector, and per-competitor cards with: Ad Library link, "Weekly radar" indicator, last-scraped time, a **Radar** toggle (`radarEnabled`), a **Refresh** button (re-scrapes via the stored Meta URL), an Active toggle, and delete.

- **WoW momentum** is computed in `concepts/route.ts:72` from the last two `countHistory` entries → `wowDelta`, surfaced as the momentum row and the `+N wk` chips.
- **Weekly radar** (`radar/route.ts`, Mondays 09:00): ages out ads not seen in `STALE_DAYS = 21` (active→inactive, feeding recency decay + the Historical tier), then re-scrapes every pinned (`radarEnabled` + `isActive`) competitor at `RADAR_COUNT = 40` (capped `MAX_PER_RUN = 50`) by URL → page_id → keyword. The new jobs flow through the normal pipeline, refreshing still-running ads and appending a fresh `countHistory` snapshot — which is what powers momentum + the Scaling-now tier over time.

**Status: live.**

### Feature 9 — Angle Bank + Swipe Library

- The **Angle Bank** (`angle_bank_entries`) is the structured teardown per concept — written by scoring, surfaced inline as the WinnerCard "Teardown," and consumed as the **remake input**. Its curation `status` flips to `approved` when a Remake is prepared (`markApproved`, `remake.ts:50`).
- The **Swipe Library** (`swipe_library`) is saved/curated winners. `POST /swipe` (`swipe/route.ts:24`) de-dupes one-per-concept-per-brand, inherits the competitor's `niche` (the library "compounds per niche"), and stores a `snapshot` jsonb that survives concept deletion. The UI surface is **only the bookmark button + optimistic `savedConceptIds` state** on the Winner Board (`component.tsx:140`).

**Status: backend live; partial UI.** **Gap:** there is **no dedicated swipe-library browsing tab** — the component renders only three tabs (Winner Board, Ad Library, Competitors). The GET `/swipe` endpoint is used solely to mark which concepts are already saved; saved winners cannot be browsed, tagged, annotated, or deleted from the UI. `tags`/`note` on save and the niche-compounding `snapshot` are written but never read back into a view.

### Feature 10 — The "v3 Remake" Bridge (Static / Video hand-off)

The **Remake** button (`remake-button.tsx`) turns a winning concept into a one-click on-brand regeneration in another system. It `POST`s `/remake`, stores the returned prefill in `sessionStorage` under `REMAKE_PREFILL_KEY = "iterio:remake-prefill"`, surfaces a compliance toast if the advisory gate failed, and navigates to `/s/static-generation` or `/s/video-generation`, where the Create form reads the prefill and the user just presses Generate.

`remake.ts` prepares the prefill server-side (`maxDuration=120`):

- **Static (Reference mode)** — `prepareStaticRemake` (`remake.ts:253`): requires the ad's stored `primaryThumbnail` (used directly as the Create form's **reference image** — already in our bucket). Gemini transcribes the verbatim **on-image** text (`extractOnAdText`), Claude rewrites it as short on-creative copy in our brand voice (`adaptOnAdCopy`, never a caption, never naming the competitor), and an advisory `complianceGate` runs. Returns `StaticPrefill` with `referencePath`/`referenceUrl`, `adCopy`, hero `productId`, `aspectRatios:["1:1","4:5"]`, `variationCount:2`, `resolution:"2K"`. The route first checks the brand has `static_ad_config` (else 400).
- **Video (deep analysis)** — `prepareVideoRemake` (`remake.ts:276`): runs a **fresh, exhaustive timestamped 1:1** Gemini read of the competitor video (`deepVideoAnalysis`, falls back to stored analysis if >14MB), then Claude composes an adapted Script/direction brief on our product (`composeVideoBrief`, lean dialogue for the ~10s runtime), plus the compliance gate. Returns `VideoPrefill` with `script`, hero `productId`, `videoType:"ugc"`, `duration:10`, `aspectRatio:"9:16"`, `resolution:"720p"`, `variationCount:1`.
- **Hero product** is auto-picked (`heroProductId`: `isHero` else first else none). The **compliance gate** (`complianceGate`, `remake.ts:196`) is a strict Claude reviewer (`emit_verdict`, six checks, default-FAIL) — but it is **advisory only**: failures surface as a warning toast and a `compliance` payload, they do not block the hand-off.

**Status: live.** Notable design decisions: the bridge reuses the *existing* Static/Video Create forms rather than generating in-system; actual generation (and its spend) happens only after the user reviews and clicks Generate. `sessionStorage` write is wrapped in try/catch (quota/disabled storage is silently ignored).

---

### Cross-Cutting Notes, Constraints & Gotchas

- **No n8n.** The whole system is code-native, matching the portal's pending-row → cron + UI-tick pattern with `FOR UPDATE SKIP LOCKED` atomic claims (`analyze.ts:300`) to avoid the cron and UI tick double-processing.
- **Dual driver design.** Every advancing function (`analyzeQueued`, `scoreAnalyzedJobs`, `completeFinishedJobs`) takes an optional `brandId`: the UI tick scopes to the open brand; crons run global. This is why a job still completes even if the user closes the tab.
- **Signed-URL expiry.** Storage signed URLs expire at `expiresIn=3600` (~1h). Both the grid (`library-tab.tsx:219`) and modal (`ad-detail-modal.tsx:40`) self-heal via a one-shot re-sign against `/ad/[id]/media`.
- **Idempotency everywhere.** Clustering recomputes from state, concept upsert is by unique key, and `countHistory` appends are run-guarded by `lastScoredRunId` — so re-running a job never double-counts.
- **Stuck-job resilience.** `sweep-stuck-jobs` (every 15 min) is the safety net: jobs >30 min → `error`, ads `processing` >15 min → requeued with the attempt handed back.
- **v1 limitations / gaps explicitly flagged:** (1) EU reach is null → the reach-velocity score term and high-confidence tier are dormant; (2) no swipe-library browsing UI; (3) two placeholder "Save to Winners"/"Generate Brief" chips in the Ad Detail modal; (4) keyword-mode discovery scrapes are less precise than a real Ad Library URL; (5) the remake compliance gate is advisory, not blocking; (6) Gemini's ~14MB inline cap degrades large-video analysis to poster-only.

Key file references: system def `src/systems/competitor-research/index.ts`; orchestrator UI `component.tsx`; pipeline `scrape-job.ts` / `ingest.ts` / `analyze.ts` / `cluster.ts` / `scoring.ts` / `scoring-run.ts`; discovery `discover.ts`; remake bridge `remake.ts` + `remake-button.tsx`; schema `src/lib/db/schema.ts:128–435`; crons `src/app/api/cron/{poll-runs,analyze,score,radar,sweep-stuck-jobs}/route.ts`; cron schedule `vercel.json`.

---

I now have everything I need. Writing the documentation section.

## Static Ad Generation System

### Purpose

The Static Ad Generation System ("Static Studio") is Iterio's flagship creative system for turning a brand's product catalog, palette, and brand intelligence into on-brand static ad creative. It is fully code-native (no n8n): a two-agent Claude prompt chain composes image-generation prompts that are fired at Kie AI's image models, and an async DB-row pipeline (UI tick + Vercel cron) drives generations to completion. It is registered as a per-brand system that is **not** enabled by default and must be turned on per brand.

System registration (`src/systems/static-generation/index.ts`):

| Field | Value |
|-------|-------|
| `key` | `static-generation` |
| `name` | "Static Generation" |
| `status` | `"live"` |
| `nav` | group `create`, order `20` |
| `perBrand` | `true` |
| `enabledByDefault` | `false` |
| `accent` | `#C2785A` |
| `infra` | `ANTHROPIC_API_KEY` (Anthropic Claude) + `KIE_AI_API_KEY` (Kie AI image generation) |

---

### High-level lifecycle

1. **Setup gate** — On first open the config row is `null`; the UI shows a setup card. Running setup researches the brand's website, non-destructively enriches its Brand Intelligence, and authors this brand's two image agents. Starter ("placeholder") prompts work immediately while this runs.
2. **Compose (Create tab)** — User picks a product (optional), chooses **Reference** or **Brief** mode, formats (aspect ratios), variation count, and resolution, then hits Generate.
3. **Two-agent chain** — Agent 1 produces a structured "format brief" JSON (vision analysis of a reference, or interpretation of a written brief); Agent 2 composes one image-generation prompt per (ratio × variation) cell.
4. **Async generation** — Each cell becomes a `pending` → `generating` DB row submitted to Kie (Nano Banana 2). A 4-second UI tick loop + a `*/2` Vercel cron poll Kie, persist the finished image to Supabase Storage, and flip the row to `completed`.
5. **Post-generation actions** — Per-tile: Refine product, Refine logo, Edit copy, Save to library, Download, Zoom.

---

### Data model (Drizzle, `src/lib/db/schema.ts:444-506`)

#### `static_ad_config` (one row per brand, `brandId` unique)
- `agent1Prompt` / `agent2Prompt` — Create-mode (reference → ad) agents (NOT NULL).
- `briefAgent1Prompt` / `briefAgent2Prompt` — Brief-mode agents (nullable; fall back to the Create-mode agents if empty).
- `brandLogoPath` — Supabase path; gates "Refine logo" and feeds Brief mode.
- `status` — `placeholder | building | ready | error`.
- `isPlaceholder` (bool), `buildError`, `builtAt`, `createdAt`, `updatedAt`.

#### `static_ad_generations` (one row per generated image, incl. refine/edit derivatives)
- `brandId`, `productId` (FK → products, `set null`).
- `mode` — `custom | brief | refined | edited`.
- `status` — `pending | generating | completed | error`.
- `kieModel` (`nano-banana-2` or `gpt-image-2-image-to-image`), `kieJobId`.
- `aspectRatio`, `resolution` (default `2K`), `outputFormat` (default `png`).
- `finalPrompt` (Agent 2 output), `analysisJson` (Agent 1 output), `referencePath`, `adCopy`, `imagePath` (final stored image).
- `batchId` (uuid), `batchIndex`, `batchSize`.
- `sourceGenerationId` — parent row for refined/edited derivatives.
- `attempts`, `errorMessage`, `createdAt`, `updatedAt`.
- Indexes: `static_gen_brand_status_idx` (brandId, status), `static_gen_batch_idx` (batchId).

#### `static_references` (per-brand reference-image library)
- `brandId`, `name`, `imagePath` (NOT NULL), `tags` (unused in UI), `createdAt`. Index on `brandId`.

Storage layout (`constants.ts`): files live under `brands/<slug>/<kind>/<file>` with kinds `static-ads` (KIND_ADS), `static-references` (KIND_REFERENCES), and `brand` (KIND_BRAND, for the logo). `KIE_INPUT_EXPIRY = 6h` — signed input URLs handed to Kie are long-lived because Kie's queue can outlast a default 1-hour URL.

---

### Setup / prompt builder (research → author)

Triggered by **POST `/api/systems/static-generation/setup`** (`setup/route.ts`, `maxDuration = 800`, Fluid Compute). The route calls `beginStaticSetup(brandId)` synchronously (seeds placeholders + marks `building`) and runs the heavy work in `after()` via `runStaticSetup(brandId)`, returning immediately. Viewers are 403'd.

`runStaticSetup` (`setup.ts:145`):
1. `beginStaticSetup` → `ensureStaticConfig` (insert placeholder config if absent, `onConflictDoNothing`) then set `status='building'`.
2. Fetch website text via `fetchWebsiteText(brand.website)` (best-effort).
3. **`enrichIntel`** (best-effort, never blocks) — uses `SECTION_BLUEPRINT` from onboarding; only fills sections that are missing or still boilerplate, decided by `needsFill()` (`authoring.ts:12` — content `< 30` chars or matching a placeholder regex). Calls Claude with the `emit_brand_intel` tool (`INTEL_TOOL` / `INTEL_SYSTEM`, `maxTokens 4000`), writing 60–140-word factual sections into `intelligenceSections`.
4. Re-read the brand (so authored prompts use freshly-enriched intel) and **`authorPrompts`**.
5. On success: write all four prompts, `status='ready'`, `isPlaceholder=false`, `builtAt=now`. On any failure: `status='error'`, `buildError` (first 500 chars) — **placeholders remain usable**.

#### Authoring is deterministic template-fill (not LLM-rewriting-a-prompt)

This is the key design decision (`templates.ts` header, `setup.ts:89` comment): quality lives in fixed master templates; per-brand customization is slot-fill from a research pass. `authorPrompts` (`setup.ts:93`):
- `inferBrandType(brand)` → `"products"` if any products, else heuristic on category/vibe (`saas|software|app|platform|agency|service|...`) → `"services"`.
- Runs two Claude research passes in parallel:
  - **`researchBrandDna`** (`research.ts:48`) — vision call (logo attached if present) with the `emit_brand_dna` tool returning `visualLanguageModifier` (a 50–75-word paragraph beginning "Shoot in the `<Brand>` visual language:"), `hexPalette`, `fonts`, `voiceKeywords`, `emotionalKeywords`, `proofPoints` (real only, never invented), `dos`, `donts`. `maxTokens 2500`.
  - **`studyProducts`** (`research.ts:111`) — filters out test/placeholder/demo/sample products, attaches each product image, calls `emit_catalog` for one dense render-ready paragraph per product. Output is `sanitize()`d (strips zero-width chars, `[bracket]` placeholder tokens, copyright years, collapses whitespace).
- Slot builders (`templates.ts`): `buildColorSubstitutions` (role-aware hex mapping with luminance fallbacks for dark/light), `buildCatalog` (or `NO_PRODUCTS_FALLBACK` text), `buildVoiceRules` (voice/emotional keywords, REAL proof points verbatim, USPs, dos/donts, compliance guardrails, casing/punctuation rules, **banned hype words** like "revolutionary"/"game-changing").
- Returns four filled prompts: `renderAgent1`, `renderAgent2`, `renderBriefAgent1`, `renderBriefAgent2`.

#### The master templates (`templates.ts`)
- **AGENT 1** (`AGENT1_PRODUCT_TEMPLATE`) — a senior visual-ad analyst that outputs strict JSON describing a reference ad's anatomy (background, layout, product placement, hero action, typography, copy structure, supporting elements, lighting, palette, mood, format classification). A `AGENT1_SERVICE_TEMPLATE` variant reframes "product placement" as "subject placement" (device/app/dashboard) and adds a critical **LAYER SEPARATION** instruction (static design layer recolors; product/device/UI layer keeps native appearance).
- **AGENT 2** (`AGENT2_TEMPLATE`) — a "creative transplant" prompt writer with two jobs: **JOB ONE** visual fidelity to the reference, **JOB TWO** complete copy replacement (every reference word is gone). Contains `{{VISUAL_LANGUAGE_MODIFIER}}` (verbatim), `{{COLOR_SUBSTITUTIONS}}`, **LAYER DISCIPLINE** (palette dresses the canvas around the product; never recolor the product or logo), a `{{CATALOG}}` to use exactly, `{{VOICE_RULES}}`, four-movement prose instructions, a 200–450-word cap, and an output contract: PART 1 prose beginning exactly "Use the attached images as brand reference." + PART 2 a metadata JSON block (stripped before hitting the model). It explicitly names **Nano Banana 2** as the target image model.
- **Brief variants** (`renderBriefAgent1/2`) prepend a "BRIEF MODE" preamble (no reference image — design from the written brief's plan) to the same scaffolds.

#### Placeholder prompts (`placeholder-prompts.ts`)
Seeded into a new config so the system works out of the box. They preserve the same format contracts (Agent 1 → single JSON object; Agent 2 → image prompt only). Includes `PLACEHOLDER_AGENT1_PROMPT`, `buildPlaceholderAgent2Prompt`, and brief-mode placeholder builders, bundled by `buildPlaceholderConfig`.

> **FIXED-PROMPT constraint:** The placeholder file documents hard "FORMAT CONTRACTS the downstream pipeline depends on" — Agent 1 must output a single valid JSON object and nothing else; Agent 2 must output only the prompt text. Any authored replacement MUST preserve these contracts. Note this is a system-internal contract; the project-wide "NEVER touch FIXED static system prompts" rule from memory refers to other portals' canonical prompts. In Iterio these prompts ARE user-editable by design (Settings → prompt editor + Rebuild), so editors must keep the JSON/prose contracts intact.

---

### Generation — Brief mode vs Reference mode

Both run through `src/systems/static-generation/generate.ts` and the chain in `pipeline.ts`. The `composePrompt` / `analyze*` calls live in `chain.ts` (named `pipeline.ts` in the file list — the two-agent module is `chain.ts`; `pipeline.ts` is the Kie-poll advance module — see note below).

| | **Reference mode** (`startGeneration`) | **Brief mode** (`startBriefGeneration`) |
|---|---|---|
| API route | `POST /generate` | `POST /generate/brief` |
| Required input | `referencePath` (a library/uploaded image) | `briefText` |
| Agent 1 | `analyzeReference` — vision: reference image → JSON, **run once**, reused across all cells | `analyzeBrief` — written brief (+ logo if present) → JSON, run once |
| Agent prompts | `config.agent1Prompt` / `agent2Prompt` | `config.briefAgent1Prompt \|\| agent1Prompt`, `briefAgent2Prompt \|\| agent2Prompt` |
| Kie image inputs | `[refUrl, productUrl?, logoUrl?]` | `[productUrl?, logoUrl?]` (no reference) |
| `mode` written | `custom` | `brief` |
| Ad copy | optional `adCopy` (blank → agent writes it) | none (no copy field) |

Shared flow (`generate.ts`):
- `loadConfig` (throws if not set up), `loadProduct` (scoped to brand), clamp ratios to 4 and variations to `MAX_VARIATIONS` (4).
- Agent 1 runs once; **Agent 2 runs per cell in parallel** via `Promise.all` (one call per ratio×variation, each ending with its own aspect ratio).
- Inputs pre-signed once at `KIE_INPUT_EXPIRY` (6h).
- A single `batchId` (uuid) groups the batch; each cell is `submitCell`'d sequentially with `batchIndex`/`batchSize`.
- `submitCell` inserts a `pending` row → calls `submitNanoBanana` → on success sets `generating` + `kieJobId` + `attempts=1`; on submit failure sets `error`. Routes are `maxDuration = 300`, viewer-403'd.

The two-agent module (`chain.ts`): `imageBlock` builds a Claude base64 vision block from a Supabase path; `stripFences` cleans Agent 1 JSON (tolerant — passes text through even if not strictly parseable); `composePrompt` assembles the FORMAT BRIEF + product facts/image (or "NO PRODUCT") + user copy + required aspect ratio, calls Claude (`maxTokens 2000`), then `stripMetadata` removes Agent 2's trailing PART-2 JSON block.

---

### Image provider — Kie AI

`src/lib/providers/kie.ts`. Base `https://api.kie.ai/api/v1/jobs` (createTask / recordInfo). Models:

| Constant | Model | Used by |
|----------|-------|---------|
| `NANO_BANANA_MODEL` | `nano-banana-2` | Reference + Brief generation (text + reference/product/logo image inputs, up to 14 images) |
| `GPT_IMAGE_2_MODEL` | `gpt-image-2-image-to-image` | Refine product, Refine logo, Edit copy |

`submitNanoBanana` defaults resolution to `2K`. `submitGptImage2` has guardrails: defaults to `1K` for `aspectRatio === "auto"` (forced), and downshifts `4K`→`2K` for `1:1`. Polling via `pollKieJob` returns `{ state, resultUrls, errorMessage }`. Spend metered by `recordKieImageUsage` (→ `usage_events`) only on the guarded `generating`→`completed` transition. Resolutions exposed in UI: `1K | 2K | 4K`, default `2K` (`constants.ts`).

---

### Async pipeline — tick + cron (`pipeline.ts`)

This is the poll/advance module. `advanceGeneration(row, slug)`:
1. Only acts on `generating` rows with a `kieJobId`.
2. `pollKieJob`; on `failed` → `fail()`. On not-yet-success → if stuck (`> 15 min` since `updatedAt`, `STUCK_MS`) fail it, else return.
3. On success, `fetchExternalMedia` (max 25 MB, 30s timeout) → `uploadToStorage` under `brands/<slug>/static-ads/<id>.<ext>`.
4. **Guarded finalize**: update to `completed` only `WHERE status='generating'` (atomic claim) and `.returning()`; only the writer that flips the row records Kie usage. This prevents double-billing across the concurrent tick + cron.

Drivers:
- **UI tick** — `component.tsx:152-169` `StaticWorkspace` runs a 4s `setInterval` pump that POSTs `/tick` while `activeCount > 0`, then reloads. `/tick` (`tick/route.ts`, viewer-403'd) calls `advanceBrandGenerations(brandId, 8)`.
- **Cron backstop** — `vercel.json` registers `/api/cron/static-generation` at `*/2 * * * *`. The route (`cron/static-generation/route.ts`) is gated by `assertCron` (Bearer `CRON_SECRET` in prod, open in dev), calls `advanceAllGenerations(20)` across all brands, AND fails config builds stuck in `building` for `> 15 min` ("Build timed out (sweep)" — placeholders stay live).
- Config-builder polling — while `status === 'building'`, `component.tsx:50` polls `/config` every 4s.

Image robustness: `GenTile` (`result-tile.tsx`) refetches generations once on an `onError` (signed URL likely expired) before giving up.

---

### Edit + Refine flows (derivatives, GPT Image 2)

All three create a new `static_ad_generations` row with `sourceGenerationId` pointing at the parent, `mode` set appropriately, `kieModel = gpt-image-2-image-to-image`, and flow through the same poll/advance chain. All only operate on a `completed` source with an `imagePath`.

- **Edit copy** (`edit.ts`, dialog `edit-dialog.tsx`):
  - `extractText` (POST `/edit/extract`) — Claude vision OCR with `emit_text_elements` tool returns every on-canvas text element (role + verbatim text).
  - User edits the strings; `applyEdit` (POST `/edit/apply`) builds a fixed "keep the canvas EXACTLY the same, only change these strings" prompt and submits to `submitGptImage2` with the source image as the only input. New row `mode = 'edited'`.
- **Refine product / Refine logo** (`refine.ts`, `GenActions` in `result-tile.tsx`, POST `/refine`):
  - `product` — requires `source.productId` + a product image; uses fixed `REFINE_PROMPT_PRODUCT` ("Keep everything the same, swap the product…") with inputs `[adImage, productImage]`.
  - `logo` — requires `config.brandLogoPath`; uses fixed `REFINE_PROMPT_LOGO` (replace only the wordmark/logo) with inputs `[adImage, logo]`.
  - New row `mode = 'refined'`. These refine prompts are fixed constants in `kie.ts`.
- **Save to library** (`saveAsReference`, POST `/save-reference`) — downloads the completed image, re-uploads it under `static-references`, inserts a `static_references` row named "Saved generation".

---

### References & logo handling

- **References** (`/references` GET/POST/DELETE, `library-tab.tsx`, and inline in `create-tab.tsx`): per-brand library of style/composition images. Upload (≤50 MB, image/* only) stores under `brands/<slug>/static-references/`. In Reference mode a reference is **required**; the Library tab manages the collection.
- **Logo** (`/logo` POST/DELETE, `LogoCard` in `component.tsx`): single brand logo stored at `brands/<slug>/brand/logo.<ext>`, path saved to `static_ad_config.brandLogoPath`. Used for the **Refine logo** pass and rendered into **Brief-mode** ads (and attached to Brief Agent 1 + brand-DNA research). Upload auto-ensures the config row.
- Both feed Kie as additional pre-signed image inputs at generation time.

---

### Brand grounding

Grounding is funneled through `brandDna(brand, siteText)` (`authoring.ts:18`) — a compact factual context (name, category, website, tagline, vibe, palette with roles, products with hero/category/price/benefits, USPs, existing non-empty intelligence sections truncated to 600 chars each, and a website-research excerpt). This context feeds the DNA research pass, the catalog study, and intel enrichment. The brand's real palette hexes are treated as **CONFIRMED** ("use exactly; do not invent"), proof points must be real, and the catalog/voice slots are injected verbatim into the Agent 2 template. Products and product media come from the brand store (`useBrand()` + `/api/brands/:id/product-media`); generation scopes products to the brand.

---

### UI surfaces

`StaticWorkspace` (`component.tsx`) renders a studio top bar (brand · Studio, active-generating badge, status badge) with four tabs:

| Tab | Component | What the user does |
|-----|-----------|--------------------|
| **Create** | `create-tab.tsx` | Pick Product (or "No product"), choose Source = **Reference** / **Brief**; Reference mode → select/upload a reference + optional Ad copy; Brief mode → write a Creative brief; choose Formats (1:1, 4:5, 9:16, 16:9), Variations (1–4), Resolution (1K/2K/4K), Generate. Results for the last batch stream into the right canvas. |
| **Gallery** | `gallery-tab.tsx` | All generations, status-filterable (all / completed / generating / error), grouped by batch with a mode label + date. |
| **Library** | `library-tab.tsx` | Upload/delete reference images. |
| **Settings** | `SettingsPanel` in `component.tsx` | Brand logo card (upload/replace/remove), collapsible prompt editors for all four agents (Create + Brief), and "Rebuild prompts". |

Banners surface state: starter-prompts warning (`isPlaceholder`), build-failed error (with `buildError`). Setup gate / "Setting up your studio…" building card show before the workspace. Each result tile (`GenTile`) supports zoom/download and, via `GenActions`, Refine product (if `productId`), Refine logo (if `hasLogo`), Edit copy, Save to library — gated tooltips, busy spinners.

**Competitor-Research handoff:** `create-tab.tsx:67-92` reads a `sessionStorage` key `iterio:remake-prefill` (target `"static"`, matching `brandId`) to pre-fill a transient competitor reference + adapted copy + product/ratios/variations/resolution, surfacing any compliance failures as a warning banner before the user generates. This is the cross-system "Remake" prefill path.

---

### Current status, gaps, and gotchas

- **Status: fully live.** Setup (research + enrich + author), both generation modes, edit, refine, references/logo, async tick + cron, and usage metering are all implemented and wired.
- **Capability claims vs. reality:** the system definition advertises "Feed + story crops in one pass" — implemented as the multi-format chip selector (multiple aspect ratios per Generate). Multi-variation per concept (1–4) is implemented. No separate "auto-refine on generation" step exists — refine is a manual per-tile action (unlike the agency static-ad-system-migrator's auto-chained Nano Banana → GPT Image 2 pipeline).
- **Module naming gotcha:** the two-agent prompt chain lives in `chain.ts` (`analyzeReference`/`analyzeBrief`/`composePrompt`), while `pipeline.ts` is the Kie poll/advance module (`advanceGeneration`/`advanceBrandGenerations`/`advanceAllGenerations`). The prompt's phrasing of "pipeline" maps to `chain.ts`.
- **Double-fire safety:** UI tick and cron both advance the same rows; the atomic `generating`→`completed` update with `.returning()` is what prevents double usage recording. Stuck-job handling is timestamp-based (`STUCK_MS = 15 min`).
- **`static_references.tags`** column exists in schema but is not used by any UI/route — minor dead field.
- **Placeholder fallback is robust:** if the prompt build errors or times out, `status='error'` but starter prompts remain active and generation still works; the cron sweep flips `building` rows stuck >15 min to `error`.
- **Brief mode requires a logo for best results** (the UI nudges the user; the logo is the only brand image attached in Brief mode aside from an optional product). Brief-mode agents fall back to the Create-mode agents if the brief-specific prompts are empty.
- **Resolution constraints** are silently coerced inside `submitGptImage2` for edit/refine (auto→1K, 1:1 4K→2K), so a user-chosen 4K on a square refine will be downshifted.
- **Cron requires `CRON_SECRET`** in production (`assertCron`); without it the cron route 500s and the only pipeline driver is the open-tab UI tick.

---

I now have a complete picture. Writing the documentation section.

## Video Generation System

### Purpose

The Video Generation system is Iterio's code-native (no n8n) studio for producing short-form video creative — UGC product demos, cinematic B-Roll, and talking-head A-Roll — driven by each brand's products, reusable character refs, and scene refs. A user composes a spot (type, refs, script, format), the portal writes a structured Seedance video prompt through a multi-stage Claude pipeline, submits one render job per variation to **Kie AI (ByteDance Seedance 2)**, and asynchronously polls each job to completion, storing the finished MP4 in Supabase Storage and surfacing it in a gallery. All AI/render spend is metered into `usage_events`.

It is registered as a per-brand, off-by-default system (`src/systems/video-generation/index.ts:5`): `key: "video-generation"`, `status: "live"`, `perBrand: true`, `enabledByDefault: false`, nav group `create`. Declared infra dependencies: `ANTHROPIC_API_KEY` (Claude prompt pipeline) and `KIE_AI_API_KEY` (Seedance video).

### Capabilities (every mode the system provides)

The system resolves a request into one of three top-level **video types**, and (for A-Roll) one of four styles. The internal "mode" string is recomputed from what actually loaded (`computeMode`, `generate.ts:41`), so the stored label reflects the template that really ran.

| Video type | Sub-mode / style | Internal `mode` | Pipeline template (Step 4) | Model |
|---|---|---|---|---|
| **UGC** | product only | `product_only` | `formatProductOnlyTemplate` | Opus |
| **UGC** | product + character | `product_character` | `formatDualRefTemplate` | Sonnet |
| **UGC** | no product, no character | `no_ref` | `formatNoRefTemplate` | Sonnet |
| **B-Roll** | (CGI product hero, no humans) | `broll` | `formatBrollTemplate` | Opus |
| **A-Roll** | Street interview (with product) | `street-interview` | `formatArollStreetWithProductTemplate` | Opus |
| **A-Roll** | Street interview (no product) | `street-interview` | `formatArollStreetNoProductTemplate` | Opus |
| **A-Roll** | Talking head | `talking-head` | `formatArollTalkingHeadTemplate` | Opus |
| **A-Roll** | Podcast (with character/scene refs) | `podcast` | `formatArollPodcastWithRefsTemplate` | Opus |
| **A-Roll** | Podcast (no refs) | `podcast` | `formatArollPodcastNoRefsTemplate` | Opus |
| **A-Roll** | Green screen | `green-screen` | `formatArollGreenScreenTemplate` | Opus |

Other capabilities:
- **Characters library** — per-brand reusable talent reference images (used in UGC-with-character and A-Roll).
- **Scenes library** — per-brand reusable backdrop/location images (used in A-Roll Podcast).
- **Multi-variation fan-out** — 1–3 renders per click (`MAX_VARIATIONS = 3`, capped because "video is expensive").
- **Live generation progress tracker** — a header badge + a 4–5s UI tick loop that advances in-flight renders, with a Vercel cron backstop.
- **Gallery** with status filtering and batch grouping; **lightbox** zoom and **download**.
- **Competitor-remake hand-off** — the Create tab consumes a `sessionStorage` prefill (`iterio:remake-prefill`) to pre-populate a UGC script/product/format from another system (e.g., a competitor remake), including compliance flags to review.

### Configuration constants

From `src/systems/video-generation/constants.ts`:
- `DURATIONS = [5, 10, 15]`, `DEFAULT_DURATION = 10`.
- `VIDEO_ASPECT_RATIOS = ["9:16","3:4","1:1","4:3","16:9"]`, `DEFAULT_ASPECT = "9:16"`. Note the comment: **4:5 is NOT supported by Seedance 2 — use 3:4.**
- `RESOLUTIONS = ["480p","720p","1080p"]`, `DEFAULT_RESOLUTION = "720p"`.
- `MAX_VARIATIONS = 3`.
- Storage "kind" segments: `KIND_VIDEOS = "videos"`, `KIND_CHARACTERS = "video-characters"`, `KIND_SCENES = "video-scenes"` (→ `brands/<slug>/<kind>/<file>`).
- `KIE_INPUT_EXPIRY = 6h` — the signed-URL lifetime for reference images handed to Kie (the render queue can outlast a 1h URL).

---

### End-to-end data flow

#### 1. Compose (UI) — `create-tab.tsx`

The Create tab (`CreateTab`) renders a control rail. On mount it loads three things in parallel: product media (`/api/brands/{brandId}/product-media`), the character library, and the scene library. The visible fields are mode-dependent:
- **Product** chooser appears for non-talking-head/non-podcast modes (uses the product's 9:16 image; "No product" tile available).
- **Characters** multi-select appears for UGC and A-Roll.
- **Scene** appears only for A-Roll Podcast.
- **Script / direction** (optional free text), **Duration** (5/10/15), **Variations** (1–3), **Aspect ratio**, **Resolution** chips.

Clicking Generate POSTs the full composition to `/api/systems/video-generation/generate`. The returned `batchId` is stored; `batchTiles` (filtered/sorted by `batchIndex`) render live in the results canvas.

#### 2. Submit + validate — `generate/route.ts`

`POST` (auth required; `viewer` rejected with 403; `maxDuration = 300`):
- Validates: `brandId` + `videoType` required; UGC needs a product **or** a script (`generate/route.ts:15`); B-Roll needs a product (`:19`).
- Guards the Seedance param sets against a hard allowlist before anything reaches Kie: aspect ∈ `{1:1,4:3,3:4,16:9,9:16,21:9}`, resolution ∈ `{480p,720p,1080p}`, duration ∈ `{5,10,15}`.
- Defaults: duration 10, aspect `9:16`, resolution `720p`, variations 1.
- Calls `startVideoBatch(opts)` **synchronously** (inserts the pending rows), then schedules the heavy work via `after(() => runVideoBatch(...))` and returns `{ batchId, ids }` immediately.

#### 3. Insert pending batch rows — `startVideoBatch` (`generate.ts:49`)

- Clamps `variationCount` to 1..3.
- Computes the `mode` and a fresh `batchId` (`randomUUID`).
- Inserts one `video_generations` row per variation with `status: "pending"`, `kieModel: videoModelId()` (= `bytedance/seedance-2`), the chosen duration/aspect/resolution/script, and `batchId`, `batchIndex` (1-based), `batchSize`.

#### 4. The prompt pipeline + job submission — `runVideoBatch` (`generate.ts:92`), runs in `after()`

This is the core orchestration. It runs the universal prompt pipeline **once** per batch, then submits **one Seedance job per row**.

1. Loads the brand slug; loads the product (`videoImageUrl ?? imageUrl`), the selected characters, and the scene from `products` / `video_characters` / `video_scenes`.
2. Recomputes `mode` from what actually loaded (product may be missing/not owned).
3. Runs the prompt pipeline (see "Prompt pipeline stages" below) → produces a `crafter`, `studioFlow`, `cleaned`, then a mode-specific `finalPrompt`.
4. For A-Roll and No-Ref UGC, runs the dialogue through `cleanVoiceDialogue` (Step 5) → `promptForSeedance`.
5. Signs reference image URLs (product, scene, characters) at `KIE_INPUT_EXPIRY` (6h).
6. **Idempotent per-row claim**: for each `pending` row, a guarded `UPDATE … WHERE status = 'pending' → 'submitting'` (`.returning(...)`). Only one runner can flip a row; a retried `after()` can never double-charge. On claim it also persists the pipeline intermediates (`crafterPrompt`, `studioFlowPrompt`, `finalPrompt`).
7. Submits the Seedance job via `submitVideoJob(...)`; on success flips the row to `generating` with `kieJobId` (task id) and `attempts: 1`; on submit failure flips to `error`.
8. Pipeline-level failure flips all still-`pending` rows in the batch to `error` (`failBatch`).

#### 5. Async advance (poll → store → complete) — `chain.ts`

`advanceVideoGeneration(row, slug)` advances one `generating` row:
- Polls Kie via `pollVideoJob(kieJobId)`. On poll exception, fails only if the row is "stuck" (`STUCK_MS = 20 min`).
- `failed` → error. **`success` with no URL → fail fast** ("Completed but no video URL returned") rather than stalling to the 20-min timeout (a known Kie edge).
- On `success` with a URL: the credit is already spent, so it **always lands a playable video**. It tries to copy the MP4 into Supabase Storage (`fetchExternalMedia` ≤ 300 MB, 120s timeout → `uploadToStorage`); on fetch/upload failure it **keeps Kie's raw URL** as `videoPath` rather than losing the result.
- Guarded completion `UPDATE … WHERE status = 'generating'` sets `status: "completed"`, `videoPath`, `outputFormat`. On success it records usage via `recordKieVideoUsage`.

`advanceBrandVideoGenerations(brandId, limit=6)` — advances a brand's `generating` rows (the UI tick). `advanceAllVideoGenerations(limit=15)` — advances across all brands (the cron backstop).

#### 6. Read back — `generations/route.ts`

`GET` returns up to 200 rows newest-first, signing each `videoPath`/`thumbnailPath`. If `videoPath` already starts with `http` (the Kie-URL fallback), it is served as-is.

### Driving in-flight renders forward (async tick + cron + sweep)

- **UI tick loop** (`component.tsx:32`): when `activeCount > 0` (statuses `pending|submitting|generating`), it POSTs `/api/systems/video-generation/tick` then reloads, on a `setInterval` of **5000 ms** (slower than images because video renders are slower). `tick/route.ts` calls `advanceBrandVideoGenerations(brandId, 6)` (auth-gated; viewer 403).
- **Vercel cron backstop**: `vercel.json` schedules `/api/cron/video-generation` every **`*/2 * * * *`** (every 2 minutes). `cron/video-generation/route.ts` is gated by `assertCron` (requires `CRON_SECRET` in prod), calls `advanceAllVideoGenerations(15)`, and then **sweeps** rows stuck in `pending`/`submitting` for >15 min to `error` ("Pipeline timed out (sweep)") — safe because no Kie job exists for those (no orphaned credit).

> Note: the cron path is `/api/cron/video-generation` (every 2 min), while `chain.advanceAllVideoGenerations` default `limit=15` matches the cron's call. There is **no thumbnail generation** in the pipeline — `thumbnailPath` is always null in practice, so gallery tiles play with `poster` undefined.

### Prompt pipeline stages (`pipeline.ts`, ~3,300 lines)

The pipeline is a port of the Adly/StudioFlow video pipeline. It is EN-only: `withLanguage()` is a no-op and the multi-language/culture engine in the system prompts is dormant. The LLM shims live in `llm.ts` — both `callGPT` (the "GPT" steps) and `callClaude` route to **Iterio's single metered Claude provider** (`@/lib/providers/claude`), so there is no OpenAI dependency. `mapModel` maps the ported model names: any `*opus*` → `claude-opus-4-8`, any `*sonnet*` → `claude-sonnet-4-6`.

| Step | Function | Model (as coded / actual) | Role |
|---|---|---|---|
| 1 | `craftPromptAgent` | `claude-sonnet-4-6` | "Prompt crafter": picks the mode template, fills brackets from product/script/character info, emits a clean seed prompt. Never asks questions; invents defaults if input is minimal; preserves all user detail. |
| 2 | `generateStudioFlowPrompt` | `callGPT` → Claude (provider default) | "Studio Flow V2" — expands the seed into a full production-ready blueprint (header, camera, environment, subject, script, audio, anti-glitch, final feel). |
| 3 | `cleanPrompt` | `callGPT` → Claude | Strips asterisks, emojis, bullets, hashtags. |
| 4a–4i | the 10 `format*Template` functions | Opus or Sonnet (table above) | Coerce the cleaned prompt into the exact per-mode "AI VIDEO PROMPT" template (each with its own variable dictionary, anti-glitch rules, reference-lock sections). All cap at ~2050 chars per their system prompts ("DO NOT EXCEED 2050"). |
| 5 | `cleanVoiceDialogue` | `callClaude` (provider default) | "Anti Voice Issue Layer" — runs **only for A-Roll and No-Ref UGC**. Rewrites only the spoken dialogue inside quotes for AI-voice clarity (spell out acronyms with hyphens, numbers as words, hyphenate odd brand/product names, CAPITALISE punch words, split >15-word sentences) while leaving all structure intact. |

`runVideoBatch` selects the Step-4 template by branching on `videoType` + `arollStyle` + presence of product/character/scene (`generate.ts:138`). Podcast routes to the "with refs" template when a character OR scene is present, else "no refs". The mode-specific final prompt is what Seedance receives as `prompt`.

#### The 15-second cap and FIXED video-prompt constraints

- **Hard 15-second design**: although the UI offers 5/10/15s and the chosen duration is passed verbatim into every template and to Seedance, the **Studio Flow V2 system prompt is hard-coded to a 15-second clip** — "Every script must fit within a 15-second clip (14.5–15.2 seconds spoken time)", a 4-beat 0–15s structure, and `Length: 14.8–15.0 seconds`. The downstream templates likewise hard-code a 0–2s HOOK through a CTA ending at `{{VIDEO_LENGTH_ROUNDED}}`. So at 5s/10s the script-timing copy is effectively mistuned to 15s — a known constraint/gotcha rather than a bug surfaced to the user.
- **FIXED video-prompt rules baked into the system prompts** (not user-tunable): a 4000-char output cap (Step 2) / ~2050-char cap (Step 4); a mandatory 8-section architecture; an always-on anti-glitch safety system (face/hand/body/environment/audio stability locks); reference-lock sections for product/character/scene/studio; "ZERO ON-SCREEN TEXT" enforcement on talking-head/podcast templates; and explicit "no physical product visible" rules for talking-head and podcast modes (products may only be discussed verbally). These align with the user's standing "FIXED prompts: never touch static/video prompts" directive in MEMORY.

### Brand grounding

Brand grounding is **light/implicit**, not a full brand-intelligence injection:
- The product is grounded by its actual reference image (`videoImageUrl ?? imageUrl`) passed to Seedance as a locked reference, plus its `name` flowing into the prompt brackets.
- Characters contribute `name` + `description` (appearance) into the crafter and as locked reference images.
- Scenes contribute a locked location/studio reference image.
- The brand slug scopes all storage paths.

There is **no** retrieval of brand voice, positioning, compliance rules, or brand-intelligence digests into the video prompt — unlike the copy/brief systems. This is a notable gap if "on-brand video" is a goal: the creative voice comes entirely from the user's script + the generic Studio Flow V2 archetype library (which is wellness/DTC-flavored, e.g., "sea moss," "alkalinity gummies" examples).

### Reference library (Characters & Scenes)

`ref-library.tsx` (`RefLibrary`, `kind: "characters" | "scenes"`) provides upload / list / delete against `/api/systems/video-generation/{kind}`:
- **GET**: lists the brand's rows with signed image URLs.
- **POST** (multipart; viewer 403): images only, ≤ 50 MB; duck-types the file (`typeof file.arrayBuffer === "function"`) to dodge a Turbopack cross-realm `instanceof File` false negative; uploads to `brands/<slug>/<kind>/<uuid>.<ext>`; inserts into `video_characters` / `video_scenes`.
- **DELETE**: removes by `id` + `brandId`.

Tables carry unused-by-the-pipeline columns `analysisJson` and `tags` (present in schema, never written by these routes — latent for a future "analyze the ref" feature).

### Gallery & result tiles

- `gallery-tab.tsx` filters by `all|completed|generating|error` (generating = pending OR generating) and groups consecutive items by `batchId`, sorted by `batchIndex`, with a per-group header (mode label · count · date).
- `result-tile.tsx` (`VideoTile`): shows a `<video controls>` when `completed` + has URL; shimmer/spinner with a status label while in flight; an error card with the message otherwise. On `<video> onError` (likely an expired signed URL) it triggers one reload to refetch fresh URLs (`reSigned` guard prevents a loop). Overlays show aspect ratio + duration; completed tiles get Expand (lightbox `Dialog`) and Download buttons.

### Database tables & key columns

| Table | Role | Notable columns |
|---|---|---|
| `video_generations` (`schema.ts:549`) | one row per generated video | `videoType`, `arollStyle`, `mode`, `status` (`pending\|generating\|completed\|error` — note `submitting` is used in code but absent from this comment), `kieModel`, `kieJobId`, `duration`, `aspectRatio`, `resolution`, `outputFormat` (default `mp4`), `script`, pipeline intermediates `crafterPrompt`/`studioFlowPrompt`/`finalPrompt`, `videoPath`, `thumbnailPath`, `batchId`/`batchIndex`/`batchSize`, `attempts`, `errorMessage`. FKs to `products`/`video_characters`/`video_scenes` are `set null` on delete. Indexes on `(brandId, status)` and `(batchId)`. |
| `video_characters` (`schema.ts:515`) | per-brand talent refs | `name`, `description`, `imagePath`, unused `analysisJson`/`tags`. |
| `video_scenes` (`schema.ts:532`) | per-brand backdrops | same shape as characters. |
| `products` | source of product image | reads `videoImageUrl` (9:16) / `imageUrl`. |
| `brands` | slug lookup for storage paths | `slug`. |
| `usage_events` | metering | written by `recordKieVideoUsage`. |

Schema columns `sourceGenerationId` (on `video_generations`) is present but unused by this code path — latent for a future "remix this generation" feature.

### API routes & cron summary

| Route | Method | Purpose |
|---|---|---|
| `/api/systems/video-generation/generate` | POST | Validate, insert pending batch, schedule `after()` pipeline. |
| `/api/systems/video-generation/generations` | GET | List a brand's generations with signed URLs. |
| `/api/systems/video-generation/characters` | GET/POST/DELETE | Character library CRUD. |
| `/api/systems/video-generation/scenes` | GET/POST/DELETE | Scene library CRUD. |
| `/api/systems/video-generation/tick` | POST | UI-driven advance of a brand's in-flight rows. |
| `/api/cron/video-generation` | GET | Cron backstop advance + stuck-row sweep (`*/2` min, `CRON_SECRET`-gated). |

### External providers / models

- **Kie AI** (`lib/providers/kie.ts`, base `https://api.kie.ai/api/v1/jobs`): `createTask` / `recordInfo`. Video model `bytedance/seedance-2` via `submitSeedanceVideo` — input: `prompt`, `reference_image_urls` (omitted when empty), `aspect_ratio` (default 9:16), `duration` (default 10), `resolution` (default 720p), `generate_audio: true`, `web_search: false`. Key from `getApiKey("KIE_AI_API_KEY")`. A provider seam (`video-provider.ts`) switches on `VIDEO_PROVIDER` (default `kie`); MUAPI/fal are stubbed comments only.
- **Anthropic Claude** (Iterio's metered provider): all five pipeline stages.
- **Supabase Storage**: stores finished MP4s and reference images; signed URLs (default 3600s; 6h for Kie inputs).
- **Usage/cost**: `computeVideoCost` estimates Seedance at `{5: $0.25, 10: $0.50, 15: $0.75}` (best-effort; Kie bills separately).

### Current status, gaps, and gotchas

**Live and working**
- All three video types and four A-Roll styles are fully wired end-to-end, with idempotent claim/submit, async polling, store-or-fallback completion, the UI tick loop, the cron backstop + stuck sweep, multi-variation fan-out, and full character/scene libraries.

**Known constraints / FIXED**
- Hard 15-second prompt design baked into Studio Flow V2 + the templates; 5s/10s renders inherit 15s-tuned script copy. Do not edit these video prompts (standing user directive).
- `MAX_VARIATIONS = 3` — each variation is a separate paid Seedance render.
- Aspect `4:5` deliberately excluded (Seedance unsupported; the route allowlist additionally permits `21:9` even though the UI does not expose it).

**Gaps / latent / dead-ish code**
- **No brand-intelligence grounding** in the video prompt (voice/positioning/compliance not injected) — video on-brand-ness relies on the user's script + a generic archetype library.
- **No thumbnail generation** — `thumbnailPath` is never populated; tiles play without posters.
- **No "edit/refine/remix"** — `sourceGenerationId` and the ref tables' `analysisJson`/`tags` are schema-only with no code using them.
- **Status taxonomy mismatch**: the `video_generations.status` schema comment omits `submitting`, though the code uses and sweeps it; harmless but a doc/code drift.
- **Mistuned timing copy** at non-15s durations is a real UX gotcha, not surfaced to the user.
- The Studio Flow V2 example content (sea-moss/wellness) can bleed stylistic bias into outputs for unrelated brands, compounding the lack of brand grounding.

**Relevant file paths**
- System engine: `/Users/sergiucastrase/n8n-agent-builder/iterio-portal/src/systems/video-generation/{index.ts,constants.ts,llm.ts,chain.ts,generate.ts,pipeline.ts,ui-types.ts,ui-utils.ts}`
- UI: `…/src/systems/video-generation/{component.tsx,create-tab.tsx,gallery-tab.tsx,result-tile.tsx,ref-library.tsx}`
- Routes: `…/src/app/api/systems/video-generation/{generate,generations,characters,scenes,tick}/route.ts` and `…/src/app/api/cron/video-generation/route.ts`
- Providers/infra: `…/src/lib/providers/{video-provider.ts,kie.ts}`, `…/src/lib/{usage.ts,storage.ts,cron.ts,db/schema.ts}`, cron schedule in `/Users/sergiucastrase/n8n-agent-builder/iterio-portal/vercel.json`

---

I now have everything needed. Note the cron map references a "brand-foundation" system for research-poll/extract/sweep, which isn't in the registry (it's a separate system the research crons serve). I have enough to write the section accurately.

## Admin, Metering, Brief Generation, Shell Placeholders & Cron Map

This section documents the cross-cutting "control plane" of the Iterio portal: the **Admin panel** (encrypted API-key store + usage/cost dashboard), the **metering layer** (`recordUsage` → `usage_events`) that powers it, the **Brief Generation** system (registered but not yet built), the **`_shell` placeholder scaffolding** that every not-yet-live system shares, and a **consolidated cron map** with a live/partial/placeholder status read on all systems.

---

### 1. Admin panel

#### 1.1 Purpose

A single, admin-only control room for the portal owner to (a) view, set, update, and revoke every external API key the systems use — with changes taking effect immediately, no redeploy — and (b) see exactly where money is being spent (Claude, Gemini, Apify, Kie, Tavily) broken down by provider, system, brand, and key.

#### 1.2 Access control

Every admin surface is gated identically:
- **Pages** (`admin/page.tsx:13-14`, `admin/api-keys/page.tsx:7-8`, `admin/usage/page.tsx:7-8`) call `getCurrentProfile()` server-side and `redirect("/dashboard")` if the profile is missing or `profile.role !== "admin"`.
- **API routes** (`/api/admin/api-keys/route.ts`, `/api/admin/usage/route.ts`) call `requireAdmin()` and short-circuit on `isAuthError(auth)`.

So role `member`/`viewer` see no admin UI and get an auth error from the routes. Roles are `admin | member | viewer` (single-owner / many-brands model).

#### 1.3 Admin landing page (`/admin`)

`src/app/(portal)/admin/page.tsx` is a server component that fan-outs three queries in parallel (`page.tsx:16-20`), each `.catch()`-guarded so a failure degrades to a zero rather than a 500:

| Stat card | Source | Detail |
|---|---|---|
| **Spend · last 7 days** | `getUsageRollup(7)` | shows `$total` + `${events} calls` |
| **Keys configured** | `getConfiguredKeyNames()` | renders `configured.length / CONFIGURABLE_KEYS.length` (i.e. `n/5`) |
| **Brands** | `count(*)` over `schema.brands` | total brand count |

Below the stats are two `LinkCard`s routing to `/admin/api-keys` and `/admin/usage`. The `Stat` and `LinkCard` presentational components are defined inline (`page.tsx:41-75`).

#### 1.4 API Keys manager

**Page:** `src/app/(portal)/admin/api-keys/page.tsx` renders a `PageHeader` and the client `<ApiKeysManager />`.

**UI component:** `src/components/admin/api-keys-manager.tsx` (`"use client"`). On mount it `GET`s `/api/admin/api-keys` (`api-keys-manager.tsx:28-32`) and renders one `BentoCard` per key. Each card shows:
- The key `label`, a status `Badge` — **success "Set"/"Env"** when configured, **warning "Not set"** otherwise (`api-keys-manager.tsx:85-91`).
- The raw `keyName` as a code chip, the human `description`, a `masked` preview chip, and one muted `Badge` per system that consumes the key (`k.systems`).
- An **Update / Set key** button (opens an inline password `Input`; Enter or "Save" submits) and — **only when `source === "custom"`** (i.e. it lives in the DB, not env) — a **Trash** remove button (`api-keys-manager.tsx:113-117`). Env-sourced keys cannot be deleted from the UI.

Save `PUT`s `{ keyName, value }`, delete `DELETE`s `{ keyName }`; both reload the list and toast.

**API route:** `src/app/api/admin/api-keys/route.ts`
- **GET** maps over `CONFIGURABLE_KEYS`, resolving each via `getApiKey()` and looking up the DB row (`apiKeys.id/updatedAt/updatedBy`). It returns per key: `configured` (truthy value exists), `masked` (`maskKey(value)`), `source` = `"custom"` (DB row present) / `"env"` (value from env only) / `"not_set"`, plus `updatedAt`, `updatedBy`, and `systems` from `systemsForKey(keyName)` (`route.ts:12-29`).
- **PUT** validates the `keyName` is one of `CONFIGURABLE_KEYS` and the value is non-empty, then `encryptKey()`s the value and upserts into `api_keys` via `onConflictDoUpdate` keyed on `keyName`, stamping `updatedBy` (`auth.profile.email ?? auth.user.id`) and `updatedAt` (`route.ts:32-62`).
- **DELETE** removes the `api_keys` row by `keyName` (`route.ts:64-71`).

#### 1.5 The encrypted key store (`src/lib/api-keys.ts`)

This is the engine the manager drives. Key facts:

- **Cipher:** AES-256-GCM. The 32-byte key is `sha256(API_KEYS_ENCRYPTION_SECRET.trim())` (`api-keys.ts:14-20`). The `.trim()` is deliberate — it guards a documented fleet gotcha where a trailing newline on the env var silently re-derives the key and bricks every stored secret. (Note: some other portals intentionally keep the trailing newline; **Iterio trims it** — so the encryption secret must be stored without a newline here.)
- **Storage format:** `encryptKey()` returns `iv:tag:ciphertext` (all hex). `decryptKey()` splits on `:` and verifies the GCM auth tag (`api-keys.ts:22-43`).
- **`maskKey()`** returns `••••••••` for keys ≤ 12 chars, otherwise `first6…last4` (`api-keys.ts:45-49`).
- **`getApiKey(keyName)`** — **DB-first, env-fallback, NO CACHE.** Reads the `api_keys` row, decrypts and returns it if present; on any DB error it silently falls back to `process.env[keyName].trim()`; returns `""` if neither (`api-keys.ts:52-64`). Because there is no cache, an admin key update is effective on the very next call across every system — the headline promise on both admin pages.
- **`getConfiguredKeyNames()`** unions DB key names with env-set `CONFIGURABLE_KEYS`, returning the names that resolve to *some* value (`api-keys.ts:67-79`). This drives the readiness/"Needs setup" badges.
- **`CONFIGURABLE_KEYS`** (`api-keys.ts:82-88`) — the 5 keys the lab can manage:

| keyName | label | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude | Brief Gen, Static, Video, Competitor Research |
| `GEMINI_API_KEY` | Google Gemini | Competitor Research (vision) |
| `APIFY_TOKEN` | Apify | Competitor Research (scrapers) |
| `TAVILY_API_KEY` | Tavily | Competitor auto-discovery |
| `KIE_AI_API_KEY` | Kie AI (image + video) | Static Ads (Nano Banana 2 / GPT Image 2), Video (Seedance 2) |

**Key ↔ system mapping** is *registry-derived*, not a separate table: `systemsForKey()` and `keysForSystem()` (`src/lib/infra.ts:29-39`) scan `SYSTEMS[].infra` for matching `keyName`s.

**DB tables touched:** reads/writes `api_keys` (`id`, `keyName`, `encryptedValue`, `label`, `description`, `updatedBy`, `updatedAt`).

#### 1.6 Usage & Spend dashboard

**Page:** `src/app/(portal)/admin/usage/page.tsx` renders a header + client `<UsageDashboard />`.

**UI component:** `src/components/admin/usage-dashboard.tsx` (`"use client"`). A window toggle (`24h / 7d / 30d` → 1/7/30 days, `usage-dashboard.tsx:17-21`) refetches `/api/admin/usage?days=…`. It shows the window total `$` + call count, and four `Breakdown` cards — **By provider / By system / By key / By brand** — each rendering a labelled bar where width = `cost / total %` (`usage-dashboard.tsx:68-101`). Empty windows render a dashed "No usage recorded… yet" state.

**API route:** `src/app/api/admin/usage/route.ts` — admin-gated, clamps `days` to `[1, 90]` (default 7), returns `getUsageRollup(days)` (`route.ts:8-10`).

#### 1.7 Metering layer (`src/lib/usage.ts`)

Every external/AI call is supposed to flow through `recordUsage()`:

- **`recordUsage(e)`** inserts into `usage_events` with `provider`, `systemKey`, `brandId`, `keyName`, `model`, `units` (jsonb), `costUsd` (fixed to 6 decimals), `meta`. It is **best-effort** — wrapped in try/catch that only `console.warn`s, so metering can never break the caller's pipeline (`usage.ts:60-75`).
- **`UsageProvider`** = `"anthropic" | "gemini" | "apify" | "kie" | "tavily"` (`usage.ts:46`).
- **Cost helpers:**
  - `computeTokenCost(model, in, out)` — per-million pricing table (`usage.ts:7-21`): Opus `$15/$75`, Sonnet `$3/$15`, Haiku `$0.8/$4`, Gemini Flash variants; unknown models fall back to `DEFAULT_PRICE` ($3/$15).
  - `computeImageCost(model, res)` — Kie image estimates for `nano-banana-2` and `gpt-image-2-image-to-image` at 1K/2K/4K (`usage.ts:25-33`).
  - `computeVideoCost(model, dur)` — `bytedance/seedance-2` at 5/10/15s (`usage.ts:37-44`).
  - **Gotcha:** image/video costs are **best-effort estimates** — Kie bills separately, so the dashboard's Kie figures are approximations, not invoiced amounts. Apify cost is taken from the run object (not the price table).
- **`getUsageRollup(windowDays)`** runs five grouped aggregates over `usage_events` since `now − windowDays` (provider/systemKey/keyName/brandId + a total), `coalesce(sum(costUsd),0)`; `norm()` coerces null group keys to `"—"` and sorts by cost desc (`usage.ts:86-119`).

**DB table:** reads/writes `usage_events` (`provider`, `system_key`, `brand_id`, `key_name`, `model`, `units` jsonb, `cost_usd`, `meta` jsonb, `created_at`).

---

### 2. Brief Generation — registered-but-placeholder system

**File:** `src/systems/brief-generation/index.ts` — a single `SystemDefinition` export, no `Component`.

| Field | Value |
|---|---|
| `key` | `brief-generation` |
| `name` | Brief Generation |
| `status` | **`placeholder`** |
| `nav` | group `create`, order `10` (first under Create) |
| `infra` | `[{ kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" }]` |
| `perBrand` | `true` |
| `enabledByDefault` | `true` |
| `accent` | `#5A7A64` |
| `capabilities` | Hook+angle variations per psychology lever; shot lists & camera direction; compliance/brand-voice guardrails; one-click handoff to production |

**Status:** This system is **a placeholder only** — there is no `Component`, no API route, no pipeline, no DB tables, and no cron. It is registered in `SYSTEMS` (`registry.ts:13-18`) purely so it appears in the sidebar/dashboard/command palette and renders the generic `PlaceholderState` "Coming soon" page (see §3). Its sole declared dependency (`ANTHROPIC_API_KEY`) lets the placeholder's setup card show an accurate Ready/Needs-setup badge before any code exists. This is the canonical example of the registry's design intent: flipping it live is a registry edit (set `status: "live"` + wire a `Component`), not a shell refactor.

---

### 3. `_shell` placeholder scaffolding

Shared UI used by any system whose `status === "placeholder"`. Lives in `src/systems/_shell/`.

#### 3.1 `placeholder-state.tsx` — `PlaceholderState({ system })`

A `"use client"` component rendered for placeholder systems. It reads `useBrand()` (current brand) and `usePortalMeta()` (`configuredKeys`), and computes `ready = allInfraReady(system.infra, configuredKeys)`. Sections:

1. **Hero** — accent-tinted gradient (`${system.accent}14`), the system icon, a **"Coming soon"** badge, the name + long `description`, and a "Will be tuned for `<current brand>`" chip with the brand's `BrandMark` (`placeholder-state.tsx:23-58`).
2. **"What it'll do"** — the `system.capabilities[]` as a checklist (`placeholder-state.tsx:62-80`).
3. **"Setup"** card — a `Ready`/`Needs setup` badge + the `<InfraChecklist>`, with footnote *"These connect when the system is wired up. In the prototype, integrations are mocked."* (`placeholder-state.tsx:82-95`).
4. **"Interface preview"** — a blurred, non-interactive ghost mockup overlaid with *"Layout & functionality coming next."* (`placeholder-state.tsx:98-129`).
5. **"How it plugs in"** — a dashed banner stating it's a modular slot live for *every brand* with no rewiring, plus a ghost link to `/brand-intelligence` (`placeholder-state.tsx:131-145`).

#### 3.2 `infra-checklist.tsx` — `InfraChecklist({ infra })`

Renders each `InfraRequirement` as a checklist row with a connected/needed pill. If `infra` is empty it shows *"Runs entirely in-app — no external services required."* (`infra-checklist.tsx:17-23`). It maps requirement kinds via `KIND_LABEL` = `{ apiKey: "API key", service: "Service", n8n: "Workflow" }`, computing readiness with `infraStatus(infra, configuredKeys)` (`infra-checklist.tsx:9-13, 24`).

#### 3.3 Readiness logic (`src/lib/infra.ts`) and a notable constraint

- `infraReady()` returns `configured.has(req.keyName)` for `apiKey`/`service`, and **always `false` for `kind: "n8n"`** — *"this lab is n8n-free"* (`infra.ts:7-10`). So any system that ever declared an `n8n` requirement could never read as ready. **No registered system currently uses `kind: "n8n"`** (all use `apiKey`/`service`), so the `n8n` branch and the `n8n` workflowKey shape in `types.ts` are effectively **dead / vestigial** — carried for type completeness but unused. Flag this as a latent gap if an n8n requirement is ever added.

---

### 4. Consolidated cron map (`vercel.json`)

`vercel.json` declares **10 Vercel cron jobs**. All cron route handlers begin with `assertCron(req)` (`src/lib/cron.ts`), which is **open in `development`** but in prod requires `Authorization: Bearer <CRON_SECRET>` (returns **500 if `CRON_SECRET` unset**, **401 on mismatch**). Each route is `dynamic = "force-dynamic"`.

| Path | Schedule | Serves | What it does | maxDuration |
|---|---|---|---|---|
| `/api/cron/poll-runs` | `* * * * *` (every min) | Competitor Research | Polls up to 10 `scrape_jobs` in `pending/running/ingesting` via `pollAndIngestJob()` — pulls Apify run results and ingests ads | 60s |
| `/api/cron/analyze` | `*/2 * * * *` | Competitor Research | `analyzeQueued({ limit: 6 })` — Gemini-vision analysis of queued `competitor_ads` | 60s |
| `/api/cron/score` | `*/2 * * * *` | Competitor Research | `scoreAnalyzedJobs()` — advances `scoring`-stage jobs → cluster variants + composite Winner Score + Angle Bank → complete | 60s |
| `/api/cron/sweep-stuck-jobs` | `*/15 * * * *` | Competitor Research | Backstop sweeper (see §4.1) | 60s |
| `/api/cron/radar` | `0 9 * * 1` (Mon 09:00) | Competitor Research | Weekly radar: age out ads unseen > 21 days → `stillActive=false`; re-scrape every pinned competitor (`radarEnabled && isActive`, cap 50) via `startScrapeJob` (url/page_id/keyword), count 40 | 120s |
| `/api/cron/research-poll` | `* * * * *` | **brand-foundation**¹ | `pollDelegatedAll()` — polls delegated/async research jobs | 60s |
| `/api/cron/research-extract` | `*/2 * * * *` | **brand-foundation**¹ | `extractAll()` — extraction pass on research jobs | 120s |
| `/api/cron/research-sweep` | `*/15 * * * *` | **brand-foundation**¹ | `sweepStuck()` — stuck-job backstop for the research pipeline | 60s |
| `/api/cron/static-generation` | `*/2 * * * *` | Static Generation | `advanceAllGenerations(20)` advances in-flight ad generations; fails `static_ad_config` rows stuck `building` > 15 min → `error` (placeholders stay usable) | 60s |
| `/api/cron/video-generation` | `*/2 * * * *` | Video Generation | `advanceAllVideoGenerations(15)`; fails `video_generations` rows stuck `pending/submitting` > 15 min → `error` (no Kie job exists yet, so no orphaned credit) | 60s |

¹ **Note / gap:** `research-poll/extract/sweep` import from `@/systems/brand-foundation/pipeline`. A **"brand-foundation"** system exists in code (with its own async pipeline) but is **not present in the `SYSTEMS` registry** (`registry.ts` registers only brief-generation, static-generation, video-generation, competitor-research). So these three crons serve a system that has no registered nav/dashboard entry — either an in-progress system not yet surfaced, or one intentionally kept off the registry. Worth confirming where to head next.

#### 4.1 `sweep-stuck-jobs` detail (`src/app/api/cron/sweep-stuck-jobs/route.ts`)

A backstop for the Competitor Research async pipeline; three idempotent passes:
1. **Stuck jobs** — `scrape_jobs` in `pending/running/ingesting/analyzing/scoring` and `updatedAt` > 30 min ago → `status="error"`, `errorMessage="Timed out (sweep)"`.
2. **Stuck analyses** — `competitor_ads` with `aiAnalysisStatus="processing"` and `updatedAt` > 15 min ago → re-`queued` **and hands back one attempt** (`greatest(aiAttempts - 1, 0)`), because a timeout isn't a content failure and shouldn't burn the retry budget.
3. **Exhausted reconciliation** — ads stuck `queued` at/over `MAX_ATTEMPTS` (imported from `competitor-research/analyze`) → `failed`, so the parent job can complete.

This embodies the portal's general async pattern: pending DB rows + atomic claim + cron/`after()` advancement + sweep-to-error backstop.

---

### 5. System status: LIVE vs PARTIAL vs PLACEHOLDER

Reading the registry (`registry.ts`) and each system's `status` field:

| System | `key` | Registry `status` | Has `Component`? | Crons | infra (keys) | Assessment |
|---|---|---|---|---|---|---|
| **Brief Generation** | `brief-generation` | `placeholder` | No | none | `ANTHROPIC_API_KEY` | **PLACEHOLDER** — renders `PlaceholderState` "Coming soon"; no pipeline/routes/tables. `enabledByDefault: true`. |
| **Static Generation** | `static-generation` | `live` | Yes (`lazy(./component)`) | `static-generation` (`*/2`) | `ANTHROPIC_API_KEY`, `KIE_AI_API_KEY` | **LIVE** — full pipeline (`chain.advanceAllGenerations`), build sweep, `static_ad_config` table. `enabledByDefault: false`. |
| **Video Generation** | `video-generation` | `live` | Yes (`lazy(./component)`) | `video-generation` (`*/2`) | `ANTHROPIC_API_KEY`, `KIE_AI_API_KEY` | **LIVE** — `chain.advanceAllVideoGenerations`, `video_generations` table, Seedance 2. `enabledByDefault: false`. |
| **Competitor Research** | `competitor-research` | `live` | Yes (`lazy(./component)`) | `poll-runs`, `analyze`, `score`, `sweep-stuck-jobs`, `radar` | `APIFY_TOKEN`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | **LIVE** — the most-built system: Apify scrape → ingest → Gemini analyze → cluster/Winner Score → Angle Bank, weekly radar. `enabledByDefault: false`. |
| **Brand Foundation** (unregistered) | `brand-foundation` | — (not in registry) | — | `research-poll`, `research-extract`, `research-sweep` | — | **PARTIAL / unsurfaced** — has a working async pipeline (`pollDelegatedAll`/`extractAll`/`sweepStuck`) wired to 3 crons, but is **absent from `SYSTEMS`**, so it has no sidebar/dashboard presence. Confirm intent. |

**Cross-cutting observations / gotchas:**
- The three "live" creative systems default `enabledByDefault: false` — they are live in code but must be turned on per brand (placeholder/Brief Gen defaults *on*).
- Kie image/video and Apify spend on the Usage dashboard are **estimates** (`usage.ts`), not invoiced figures; only token costs map to provider price tables, with unknown models silently using `DEFAULT_PRICE`.
- API-key updates are **uncached** by design (`getApiKey` reads DB every call) — fast propagation, at the cost of a DB read per call.
- `kind: "n8n"` infra is **dead code** in this n8n-free portal (`infra.ts:8` hard-returns `false`); no registered system uses it.
- All cron readiness depends on `CRON_SECRET` being set in prod, or every cron 500s; in dev they're wide open.