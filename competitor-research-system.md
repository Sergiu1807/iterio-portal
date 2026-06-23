---
type: resource
area: Resources
status: active
created: 2026-06-23
updated: 2026-06-23
tags: [ai-automation, competitor-research, meta-ads, build-spec, portal]
---
# Competitor Research System — Spec & Tuning Brief

> **How to use:** copy everything below the line and paste it into the Claude Code session that has the system codebase. It's a *target spec* — the agent audits the current build against it and aligns it. (Self-contained on purpose: no external links needed.)
>
> _Vault refs for me (not the agent): Creative Delivery SOP Phase 2–3, Delivery Capabilities B1/B2 + A1/A4/A5/A7, Reusable Architecture Patterns #1/#6/#7, Meta Andromeda notes, Demo Portal._

---

# Competitor Research System — Target Spec (Tuning Brief)

## Your task
You have the codebase for my **Competitor Research System** (part of my personal ITERIO portal — a clean, client-data-free environment for delivery, sales demos, and content). I have already built a version of it. **I want to tune it to match this spec exactly.**

Work in this order:
1. **Audit** the current implementation against every section below. Produce a **gap list** (what matches, what's missing, what's divergent) before changing code.
2. **Propose** the change set (data model migrations, new scoring, UX changes) and flag anything destructive or expensive — **ask before** running migrations or incurring new paid-API usage.
3. **Apply** in the v1 → v2 → v3 order at the end. Keep my existing stack and patterns; align, don't rewrite.

Assume my stack: **n8n** (orchestration) + **Claude** (analysis/reasoning) + **Gemini** (vision + search-grounded discovery); **Next.js/React/TS/Tailwind/Radix** portal; **Postgres (Neon) + Drizzle**; **Cloudflare R2** assets; **Apify actors + official Meta Ad Library API + Tavily** for data; **Telegram** for notifications. Use direct provider nodes with strict structured JSON output.

---

## 1. North star (what this system actually is)
Not a search box — a **competitive creative radar**. The motion is: **one brand in → its competitor set discovered → every ad scored & tiered by real winner-signal → each winner deconstructed into a structured "angle bank" entry → one click → on-brand AI variants out.** Research and generation are one continuous loop.

It serves three payoffs off a single run: (a) fuel for free-sample creative batches, (b) the live sales demo ("watch me find a brand's winners and remake them"), (c) highest-authority content (ad teardowns). Every design choice should serve all three.

---

## 2. Operation & UX requirements
- **Single input:** brand *name*, *domain*, or *Meta Page URL*. Nothing else required.
- **Competitor expansion:** from that one brand, discover the **top 8–12 competitors** in its niche (see §5), then harvest all of them — not just the seed brand.
- **Async, never babysat:** submit → background run (n8n) → portal shows live "researching…" status → board populates → **Telegram ping when done**. Mirror my existing async/callback contract.
- **Output = a Winner Board** (see §9), not a table dump. Visual, skimmable, sorted by winner score, tier badges, signals, and the teardown inline.
- **Persistent + compounding:** every run writes scored winners into a **swipe library** (Postgres) so the asset grows over time per niche.
- **Scheduled radar:** for pinned niches/brands (start with **supplements/health DTC**), run weekly on a cron and send a **digest of what changed** — new ads, newly-scaling ads (see §3 momentum). The diff is the product.
- **Personal-portal rule:** no client data here. Recreation seeds use a dummy/own brand only.

---

## 3. Winner classification (the core — get this right)
**Do not rank by "longest running" alone.** Longevity is the spine, but a single-axis sort produces false winners (brand/awareness ads, low-spend ads left running, sloppy accounts). Compute a **composite Winner Score** from multiple signals, all derivable from the Ad Library:

| Signal | Why it matters | Default weight |
|---|---|---|
| **Continuous active days** | Survived the kill-switch → presumed profitable | 0.30 (spine) |
| **# active variants of same concept** (duplication) | Advertiser is *scaling* it = real budget = confidence | **0.35 (confirmer)** |
| **EU reach + reach/day** (DSA data, when available) | Actual eyeballs + spend-velocity proxy | 0.20 (renormalize if absent) |
| **Format/placement spread** | Same idea adapted across square/vertical/story | 0.10 |
| **Relaunch / resurrection** (gap → restart) | Tested, killed, brought back = proven | 0.05 bonus |
| **Recency** (last-seen-active) | Currently winning > historical | multiplier (decay) |

**The duplication signal is the most important and the most overlooked** — weight it at or above longevity. When the same hook is cloned 8–15× across active ads, that's a control being scaled. Longevity says "not a loser"; duplication says "actively a winner."

**EU reach is your unlock (you're targeting EU brands too):** under the DSA, the Ad Library exposes **reach for all commercial ads served in the EU** (total + daily + by country/age/gender, with date range; `eu_total_reach` etc. via the API). Use it when present — high reach + long life + many variants = a *confirmed* winner, not a guess. When absent (e.g. US-only brands), don't penalize — drop the reach term, renormalize the other weights, and lower the record's **confidence** flag.

**Niche caveat (supplements/health):** ads frequently die from **Meta policy rejection**, not poor performance. So a long-runner that suddenly vanished may be a *killed winner*. In this niche, weight **duplication + relaunch** higher than raw longevity, and treat a long-runner's sudden death as "investigate," not "discard."

**Score the change over time, not just the snapshot.** Persist a per-run snapshot of each concept's variant count and active set. Momentum (variant count rising week-over-week, brand-new ads) is what powers the "Scaling now" tier and the weekly digest. This is the real edge over any static leaderboard.

Reference scoring model (transparent + tunable — implement, expose the weights as config):
```
# normalize sub-signals to 0..1
longevity = min(active_days / 90, 1)                     # saturates ~90d
scaling   = min(active_variant_count / 12, 1)            # 12+ near-dup active creatives = maxed
reach_vel = present? min(eu_reach_per_day / NICHE_BENCHMARK, 1) : null
spread    = min(distinct_formats / 4, 1)
relaunch  = resurrected ? 0.10 : 0
recency   = exp(-days_since_last_active / 30)            # 1.0 if active today, decays once ended

W = { longevity:0.30, scaling:0.35, reach:0.20, spread:0.10 }   # if reach_vel null, drop it & renormalize
base  = Σ W_i * signal_i  + relaunch
score = round(100 * base * recency)                              # 0..100
confidence = (reach_vel != null && strong_signals >= 2) ? "high" : "medium|low"
```

Tiers (defaults — make them tunable; assign highest-priority match in order):
- 🏆 **Proven control** — `active && active_days>=45 && active_variants>=4 && score>=72`. Model these first.
- 🔥 **Scaling now** — `active && (variant_count_delta_WoW>0 || active_variants>=3) && 7<=active_days<=60 && score>=58`. Catch early.
- 🧪 **In testing** — `active && active_days<14 && active_variants<=2`. Watchlist.
- 📚 **Historical swipe** — `!active && peak_active_days>=30`. Reference only.

---

## 4. Data sources
- **Apify Meta Ad Library actor** = primary harvest (full global commercial coverage: creatives, start date, active status, variant grouping). 
- **Official Meta Ad Library API** = enrichment for **EU reach** fields where the seed/competitor serves the EU.
- **Dedup / variant clustering:** hash creatives (image/video) + compare primary text to cluster near-duplicates into one **concept**; the cluster's `active_variant_count` is the duplication signal. Maintain a UNIQUE index to avoid double-counting across runs.
- **Honesty about limits (encode, don't pretend):** commercial **spend & impression ranges are EU/politics-only** — for non-EU commercial ads you only have longevity + duplication + format spread. Surface confidence accordingly; never fabricate spend.

---

## 5. Competitor discovery
Given the seed brand + inferred niche:
1. **AI discovery pass** (Gemini, search-grounded): return the top 8–12 direct competitors (name + domain + Meta Page if findable).
2. Harvest each from the Ad Library.
3. **Curate + persist** a competitor set per niche so repeat runs don't rediscover from scratch; let me edit the set.

---

## 6. Analysis / teardown (where the moat is)
Harvest is a commodity; the **judgment** is the moat. For each winning concept:
- **Gemini Vision** reads frames/image → on-screen text, format, pacing, what's literally shown.
- **Claude analyst** → a strict-JSON **teardown** = one **Angle Bank entry**. This is both the research output and the generation input.

Teardown schema (enforce as structured output):
```json
{
  "ad_id": "string",
  "advertiser": "string",
  "first_seen": "YYYY-MM-DD",
  "last_seen_active": "YYYY-MM-DD",
  "still_active": true,
  "format": "static | carousel | video | ugc",
  "platforms": ["facebook","instagram","reels","audience_network"],
  "offer": "the actual offer/promo in the ad",
  "angle": "the big promise / core idea",
  "hook": "first 1–2s / first line, verbatim",
  "mechanism": "the unique 'why it works' reason",
  "awareness_level": "unaware | problem | solution | product | most",
  "emotional_driver": "dream | nightmare | speed | delay | certainty | risk | ease | difficulty",
  "secondary_drivers": ["..."],
  "beat_structure": [
    {"beat": "HOOK", "text": "..."},
    {"beat": "PROBLEM", "text": "..."},
    {"beat": "MECHANISM", "text": "..."},
    {"beat": "PROOF", "text": "..."},
    {"beat": "DREAM", "text": "..."},
    {"beat": "CTA", "text": "..."}
  ],
  "visual_notes": "Gemini Vision summary: on-screen text, scene, pacing",
  "native_score": 0.0,
  "compliance_flags": ["e.g. implied disease claim", "before/after imagery"],
  "winner_score": 0,
  "winner_tier": "proven | scaling | testing | historical",
  "signals": {"active_days":0,"active_variants":0,"eu_total_reach":null,"eu_reach_per_day":null,"relaunched":false,"formats":1},
  "confidence": "high | medium | low"
}
```
`awareness_level` = Eugene Schwartz 5 stages. `emotional_driver` = the four polarity axes (Dream↔Nightmare / Speed↔Delay / Certainty↔Risk / Ease↔Difficulty). `native_score` = how organic / "doesn't look like an ad" it is (Andromeda native principle).

---

## 7. Data model (align persistence to this)
- **ResearchRun** — seed brand, niche, status, started/finished, source snapshot.
- **Advertiser** — page id, name, niche, is_competitor_of.
- **Ad** — ad_id, advertiser, first_seen, last_seen_active, still_active, format, platforms, creative_ref, raw payload.
- **CreativeAsset** — R2 ref, type, perceptual hash (for dedup).
- **ConceptCluster** — concept key, member ad_ids, active_variant_count, **count_history[]** (for WoW momentum).
- **WinnerScore** — per concept: sub-signals, score, tier, confidence, computed_at.
- **AngleBankEntry** — the teardown JSON, FK to concept, status (raw|approved), used_in_generations[].
- **SwipeLibrary** — saved/curated winners, tags, niche.

---

## 8. The AI-recreation bridge (the payoff)
From any winner card: **"Remake"** → take its Angle Bank entry + the target Brand Intelligence (dummy/own brand here) → my **Grounded Creative Agent** (strict structured output + clamp/validate + compliance scan) → **Winner→Variations engine** (constraint-grid variation with differentiation guarantees) → assets to gallery.

Enforce these principles:
- **Extract → re-express, never clone.** Store and reuse the *DNA* (angle / mechanism / beat structure), not the competitor's literal pixels/audio. The remake is rebuilt on the target brand. This is the quality bar **and** the legal/compliance safety.
- **Built for Andromeda:** default to **many on-brand static variants** (volume), **native** look (not polished "attention-hijack"), optional **one-keyword identity trigger** in the headline, multi-format crops. Volume-first because the algorithm is starved for fresh creative.
- **Compliance gate every output** through the QA scorecard — ship only if ALL pass: on-brand · doesn't-look-AI · compliant (no prohibited claims/imagery for the category; supplements claim-safe) · hook lands in 1–2s · clarity (one job per element, single CTA) · angle integrity (built on a real mechanism, not just "pretty"). This gate backs the "on-brand or you don't pay" guarantee.

---

## 9. Winner Board UI
- Grid of concept cards: creative thumbnail/video · **tier badge** · live signals (days active, # variants, EU reach if any, confidence) · teardown (angle/hook/mechanism/emotional driver/beat structure) expandable.
- **Sort/filter** by score, tier, brand, format, **emotional driver**, awareness level, recency.
- **Momentum view:** "🔥 New & scaling this week" surfaced at top (from WoW deltas).
- **One-click "Remake"** on each card → §8.
- Feel = like a great morning brief: a glance, winners surfaced, noise hidden.

---

## 10. Definition of great (acceptance criteria)
- [ ] One brand input → competitor set auto-discovered → single async run → board out, Telegram ping.
- [ ] Winner score is **composite** (longevity + duplication + EU reach + spread + relaunch + recency), weights configurable, **confidence** shown, never longevity-only.
- [ ] Variant/duplication clustering works and drives the score.
- [ ] EU reach enriched when available; absence lowers confidence, doesn't break scoring.
- [ ] Tiers + **WoW momentum** ("scaling now") visible; weekly radar cron + digest.
- [ ] Each winner → structured teardown (the schema) persisted as an Angle Bank entry.
- [ ] One-click Remake → on-brand variants that pass the compliance scorecard.
- [ ] Swipe library persists and compounds per niche; supplements/health DTC seeded first.
- [ ] No client data in this portal.

---

## 11. Build order
- **v1 (do first):** harvest → dedup/variant clustering → composite score + tiers → Winner Board + structured teardown + swipe library. Pointed at supplements/health DTC. *No remake yet* — the board alone already powers free-sample batches, the demo, and content.
- **v2:** WoW momentum + weekly radar cron + Telegram digest; competitor auto-discovery hardening; EU-reach enrichment.
- **v3:** Remake bridge (Grounded Creative Agent + Winner→Variations) + compliance gate; teardown→content-post auto-draft; optional chat/vault trigger.

## Decisions to surface to me before building
- Which Apify actor + run budget/cadence; whether the official API EU-reach access (app review/identity) is set up.
- `NICHE_BENCHMARK` values for reach normalization (start with a supplements/health DTC baseline).
- How many competitors per run (default 10) and creative-retention policy in R2.
