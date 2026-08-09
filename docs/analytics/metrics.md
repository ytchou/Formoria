# Formoria Metric Registry

**Purpose:** the canonical definition of every metric Formoria steers by. PostHog has metric *serving* primitives but no metric *governance* — no plan enforcement, no violation reporting, no required-definition gate. So the definitions live here, in the repo, under review, and PostHog holds a mirror. If this file and a PostHog insight disagree, **this file is right and the insight is broken.**

**Owner:** Yung-Tang (Patrick) Chou
**Last reviewed:** 2026-08-09
**Companion files:** `src/lib/analytics/events.ts` (the event registry — the sole place event-name literals may exist), `docs/analytics/posthog-analytics-plan.md` (the research this registry was derived from).

## How to change a metric

1. **Edit this file first.** A metric that changes in PostHog but not here has no definition; it has a chart.
2. Then change PostHog to match.
3. **Every PostHog *action* edit gets a dated annotation** (annotations render on every insight) **plus a PR to this registry.** Actions are retroactive and unversioned — editing one silently restates every historical chart that uses it, and there is no revert.
4. Changing a metric's definition means its history is no longer comparable across the change. Say so in the entry's caveats, with the date.

---

## How to read this registry

Every entry carries the same seven fields. An entry missing any of them is not ready to steer by:

| Field | What it must contain |
|---|---|
| **Meaning** | Plain English. What a human would say this number tells you. |
| **Implementation** | The exact mechanism: which event(s), which properties, which action, or the HogQL saved view. |
| **Canonical insight** | Link to the *one* PostHog insight tagged `canonical` for this metric. Exactly one insight per metric may carry that tag. |
| **Filters** | Every filter applied, stated explicitly — including `filterTestAccounts: true` and the post-launch reference date `timestamp >= 2026-07-31 17:30 Asia/Taipei`. |
| **Window** | The reporting window and refresh cadence. |
| **Caveats** | What would make this number wrong or misread. |
| **Confidence / Status** | How well-sourced the definition is, and whether it is computable today. |

**Two rules that apply to every entry below.**

- **Always report N with the rate.** A rate without its denominator invites a decision it cannot support.
- **Every canonical insight sets `filterTestAccounts: true` and filters to `timestamp >= 2026-07-31 17:30 Asia/Taipei`.** The product launched at that moment; everything before it is the founder's own clicking, and letting it into a baseline makes real user behaviour look like a collapse.

> **This rule was aspirational until 2026-08-09 — it described nothing that was true.** Every canonical insight was HogQL with `now() - INTERVAL 28 DAY` hardcoded and no `filterTestAccounts` at all, and the project's test-account filter matched a person property the app never set. Both are now genuinely enforced: each insight carries `greatest(now() - INTERVAL 28 DAY, toDateTime('2026-07-31 17:30:00'))` (self-healing after 2026-08-28) plus the `{filters}` placeholder with `filterTestAccounts: true`. Anything you read off these charts dated before 2026-08-09 was measured under the old, dirty definition. See *Known data caveats*.

---

## Traffic-scale gates

The discipline that makes everything below safe. 95% CI half-width ≈ 1.96·√(p(1−p)/n). At p=0.20: n=30 → ±14pp; n=100 → ±7.8pp; **n=250 → ±5.0pp (the first decision-grade point)**; n=400 → ±3.9pp.

| Analysis | Unlock at | Status (2026-08-01) |
|---|---|---|
| Absolute counts, event-stream reading | now | **Active** |
| Submission completion *rate* | ≥30 form opens/month | 2 — report counts only |
| Multi-step funnel *rates* | ≥250 entering | ~52 — shape only, no percentages |
| Week-over-week rate comparison | ≥250/week | Far off — use 28d trailing exclusively |
| Any segmented rate (locale, category, device, source) | ≥400 *in the segment* | Never report; splitting 30 four ways gives n≈7 |
| Cohort retention curves | ≥100 per monthly cohort | Far off |
| A/B tests | ≥350 conversions/variant/month (~1,750 sessions/mo) | At ~6 qualified referrals/week this is 1–2 years per test — **not hard, impossible** |

> **The rule, stated once and prominently: below roughly 250 observations, every rate is noise.** Report absolute counts on 28-day trailing windows, and always state N. Write these thresholds onto the dashboards themselves.

A second, temporary gate: **no 28-day window exists until roughly 2026-08-28**, and baseline accrual for the DEV-1297 events starts only from that ticket's deploy date. Until then, report cumulative-since-launch counts and label them as such. No metric on this page has usable history before the DEV-1297 deploy.

---

## North Star — Successful Discovery Sessions (SDS)

**Meaning:** the share of browsing sessions in which a visitor was successfully handed off to a brand they had genuinely engaged with.

- **Numerator:** distinct sessions containing ≥1 *qualified brand referral* — an engaged `brand_detail_viewed` (dwell ≥15s **or** ≥1 deep interaction) followed by `external_link_clicked` for the same brand.
  *Deferred second clause:* **or** ≥1 `brand_saved` — **dormant** until saves reach n≥30 (see Known data caveats).
- **Denominator:** distinct sessions with ≥1 of `brand_list_viewed` / `brand_detail_viewed` / `brand_search_executed`.
- **Implementation:** HogQL SQL insight saved as a view — compound logic, not expressible as an action. Reads `brand_detail_engaged` (`brand_slug`, `trigger`) for the engagement gate and `external_link_clicked` (`brand_slug`, `link_type`, `link_surface`) for the referral, joined on `brand_slug` within a session. Dedupe per (session, brand).
- **Canonical insight:** [Pulse · Successful Discovery Sessions (28d)](https://us.posthog.com/project/520725/insights/SePhFCXk)
- **Filters:** `filterTestAccounts: true`; `timestamp >= 2026-07-31 17:30 Asia/Taipei`.
- **Window:** trailing 28d, refreshed weekly. **Report count and rate together.**
- **Status:** **Instrumented; awaiting volume.** DEV-1297 closed both blocking gaps — `brand_detail_engaged` now supplies the engagement signal and `external_link_clicked` now carries `brand_slug`. The metric is computable in principle; it is not yet *readable*, because volume is far below the 250-observation gate.
- **Confidence:** Medium. The session-denominator shape is well-sourced; the compound numerator is a research synthesis, not established practice.

---

## Primary inputs

Govern by these five. The north star is a communication device; these are what you act on.

### 1. Referral rate (demand liquidity)

- **Meaning:** how reliably a browsing session ends in a real handoff to a brand. The demand-side liquidity measure the marketplace literature treats as *the* early-stage metric.
- **Implementation:** qualified-referral sessions ÷ browse sessions — same numerator and denominator as SDS, reported as a rate on its own. Reads `brand_detail_engaged` + `external_link_clicked` (`brand_slug`).
- **Canonical insight:** [Pulse · Successful Discovery Sessions (28d)](https://us.posthog.com/project/520725/insights/SePhFCXk) (shares the north-star insight — identical numerator and denominator, read as a rate; exactly one insight per metric may carry `canonical`, so this metric does not get a duplicate tile)
- **Filters:** `filterTestAccounts: true`; post-launch reference date.
- **Window:** 28d trailing.
- **Confidence:** High.
- **Status:** **Instrumented; awaiting volume** (was: blocked on instrumentation gaps 1–2, closed by DEV-1297).

### 2. Brand-detail engagement rate

- **Meaning:** of the sessions that reached a brand page, how many actually read it — gallery, FAQ, purchase channel, or ≥50% scroll.
- **Implementation:** sessions with ≥1 `brand_detail_engaged` ÷ sessions with ≥1 `brand_detail_viewed`. Qualifying `trigger` values: `dwell` (≥15s), `gallery`, `faq`, `channel`, `scroll_50`.
- **Canonical insight:** [Pulse · Brand-detail engagement rate (28d)](https://us.posthog.com/project/520725/insights/040rGGbp)
- **Filters:** `filterTestAccounts: true`; post-launch reference date.
- **Window:** 28d trailing.
- **Confidence:** High.
- **Status:** **Instrumented; awaiting volume** (was: blocked on gap 1, closed by DEV-1297).
- **This metric is not decoration — it is the anti-Goodhart guard on metric #1.** Without it, the system rewards making brand pages *worse*: strip the verification tier and the purchase-channel detail, and outbound clicks go up. Never report referral rate without this beside it.

### 3. Query success rate

- **Meaning:** how often search finds the visitor something.
- **Implementation:** `1 − (brand_search_empty ÷ brand_search_executed)`, both counted as raw events.
- **Canonical insight:** [Pulse · Query success rate (28d)](https://us.posthog.com/project/520725/insights/vNHjHtjR)
- **Filters:** `filterTestAccounts: true`; post-launch reference date.
- **Window:** 28d trailing.
- **Confidence:** High.
- **Status:** **Computable now** — the only primary input that never needed new instrumentation. Last read 9/13 = 69% at n=13, which is well under the noise gate: directional only.

### 4. Catalog coverage

- **Meaning:** what share of the published catalog is actually earning referrals, as opposed to sitting inert. The number brand owners will eventually ask about.
- **Implementation:** distinct `brand_slug` values with ≥1 qualified referral ÷ count of published brands. Reads `external_link_clicked.brand_slug` — this property is what DEV-1297 added; per-brand attribution was impossible before it.
- **Canonical insight:** [Catalog coverage — brands referred / viewed / published (28d)](https://us.posthog.com/project/520725/insights/0bA9F3s5). Reports three numbers, not a ratio of a ratio: brands referred, brands viewed, and the published catalog size. At 2026-08-09: **47 referred / 114 viewed / 790 published — 5.9% of the catalog earned a referral.**
- **Filters:** `filterTestAccounts: true`; post-launch reference date.
- **Window:** 28d trailing.
- **Confidence:** Medium.
- **Status:** **Instrumented; awaiting volume** (was: blocked on gap 2, closed by DEV-1297).

### 5. Supply throughput

- **Meaning:** how much new supply entered and cleared the pipe.
- **Implementation:** count of `submission_completed` + newly published brands. `brand_listing_published`, `brand_claim_approved`, and `brand_owner_edit_published` were all implemented by DEV-1297. As of 2026-08-09, PostHog had received 216 `brand_listing_published` events through the shared server SDK; production had 0 claim approvals and 0 owner-edited brands since the instrumentation shipped. The one lifetime claim approval predates DEV-1297.
- **Canonical insight:** **Both tiles are parked off-dashboard as of 2026-08-09 and must not be read.** [Conversion · Submission funnel (28d)](https://us.posthog.com/project/520725/insights/8nd6neL5) carries a single distinct_id for every event (DEV-1411). [Supply · Post-submission outcomes (28d)](https://us.posthog.com/project/520725/insights/ISzNf0Ak) stays off-dashboard until real claim and owner-edit volume validates the implemented events in production. This is a volume and validation decision, not an instrumentation defect. **Read new listings from Supabase (`brands.status='approved'`) until real post-submission volume exists.**
- **Filters:** `filterTestAccounts: true`; post-launch reference date.
- **Window:** 28d trailing.
- **Confidence:** Medium.
- **Status:** **Instrumented; awaiting production observation and volume.** `brand_claim_approved` and `brand_owner_edit_published` are implemented but had no qualifying production actions to emit as of 2026-08-09. Report counts only until the gates open; there is no meaningful rate here.

---

## Counter-metrics (mandatory, not optional)

Every one of these exists to catch the north star being gamed. They ship *with* the Pulse dashboard, not after it. A north star without its counter-metrics is an instruction to make the product worse in a measurable direction.

1. **Brand-detail views per successful session** — the direct Bing counter-metric. Rising views-per-session with flat referrals means the page is failing to answer, not that engagement improved.
2. **Share of referrals with <15s dwell** — hollow handoffs. A referral the visitor could not have evaluated is not a success.
3. **Share of sessions with ≥3 outbound clicks to different brands** — indecision misread as conversion. Five clicks may be one confused visitor, not five conversions.

- **Canonical insight:** [Pulse · Counter-metrics (28d)](https://us.posthog.com/project/520725/insights/I2k13WZi) — all three counter-metrics ride this one tile.
- **Filters:** `filterTestAccounts: true`; post-launch reference date.
- **Window:** 28d trailing, reviewed alongside the north star.

---

## Validity caveats — is outbound click a valid conversion?

**Defensible as the primary observable proxy. Not defensible as a north star, and not as a raw count.** That is the whole reason SDS wraps it in a session denominator and an engagement gate rather than counting clicks.

Five documented failure modes:

1. **Unverified handoff.** You cannot see whether the destination loaded, or produced anything.
2. **Goodhart / premature exit — the Bing precedent.** Bing optimized "queries per unique user," which rewarded shipping related-search modules that pushed real results down; the metric rose while users defected. For Formoria, optimizing outbound clicks rewards making brand pages *less* informative — structurally penalizing the differentiator (verification tier, purchase-channel info). A 4-second exit from an empty page is indistinguishable from a 4-second exit from a perfect one.
3. **Raw count measures acquisition, not value.** It rises with traffic alone.
4. **Multi-click ambiguity.** Five clicks may be one indecisive visitor.
5. **Makes half the product invisible.** Saves and the entire owner side deliver value with no outbound click.

**Mitigations, in priority order:** session denominator → engagement qualification gate → dedupe per (session, brand) → the counter-metrics above → long-run per-brand UTM plus owner-reported inbound, which is the *only* path to ever validating the proxy against ground truth.

**Negative finding (High confidence): no credible, methodologically documented benchmark exists for directory outbound-click rate.** Three separate search angles returned only ad-CTR and SERP-position data (a different denominator entirely) plus SEO listicles with no methodology. The widely-repeated "30–60% fill rate" is secondhand, methodology-free, and drawn from *transactional* marketplaces. **Benchmark against your own trailing 8-week median. Never against an industry number.**

---

## Retention — demote, don't delete

**Verdict: do not steer by retention for at least a year.** Keep exactly one view:

- **Unbounded (rolling) retention, monthly cohorts, 30/60/90-day marks, reviewed quarterly.**
- **Canonical insight:** [Return rate — visitors coming back on another day (28d)](https://us.posthog.com/project/520725/insights/nD4ddTeT) — created 2026-08-09 as the minimum viable version of this: share of visitors active on 2+ distinct days. It counts browsing events only, so the `brand_listing_published` phantom persons cannot inflate it. At 2026-08-09: **9 of 243 visitors returned, 3.7%.** Cohort curves stay deferred until monthly cohorts exceed ~100.
- **Filters:** `filterTestAccounts: true`; post-launch reference date.

N-day retention would report near-zero for an irregular-cadence discovery product and read as failure when it isn't. HEART's *Task Success* is the correct primary lens — the framework's author explicitly permits dropping categories. But pure one-shot is also wrong: a directory with zero returners is a search-result artifact, not a destination. So retention stays, as a long-horizon PMF signal at quarterly grain. Add bracket retention (D0 / 1–7 / 8–30 / 31–90) once monthly cohorts exceed ~100.

`saved_brand_revisited` (added by DEV-1297) is implemented but not yet production-observed. As of 2026-08-09, production had 0 saved brands total and 0 new saves, so there was no qualifying revisit to emit. It remains the sharpest return-with-intent signal available and should feed this view once real save volume permits — it is far more informative than an undifferentiated return visit.

---

## Event governance

**The permanence constraints. These are not preferences; they are properties of PostHog.**

- **Events cannot be renamed.** PostHog: *"It's not possible to rename events… Renaming is very resource intensive because it requires updating every existing event in the database."* The only path is dual-emit plus an action bridging old and new — a permanent split namespace.
- **Events cannot be selectively deleted.** Old names never disappear from the project.
- **Property types must never change.** Type mutation is the **top decay vector**: historical rows keep the old type, and every aggregate spanning the change is silently wrong. Adding a property is safe; retyping one is not.
- **Actions are retroactive and unversioned.** They apply to past events, insights reference them by ID rather than version, and there is no revert (open PostHog issue since 2021). An action may therefore be a **view over facts**, never the **sole definition of a headline metric**.
- **The custom event is the fact; the action is the view.** Every business-critical, stable behaviour must ride a named custom event. Autocapture cannot serve here at all: `mask_all_text: true` strips `$el_text` before send, so text-based action definitions — the most readable kind — are structurally impossible on this project.

**Enforcement in this repo.** `src/lib/analytics/events.ts` is the sole place event-name literals may exist; `scripts/check-event-registry.mjs` runs in CI and fails on a bare literal at any call site. `src/lib/analytics/events.test.ts` holds a hardcoded snapshot of every event name — a rename fails the suite loudly rather than splitting a time series quietly.

**PR gate for any analytics change:** name matches the snake_case `object_verb` convention; property types unchanged; owner populated in PostHog Data Management; a deprecation carries a migration plan rather than a rename.

**Quarterly review** on two freshness indicators (30-day volume, query volume). Zero-volume events get unverified and tagged `deprecated`.

**Deprecation path — the only safe sequence:**

1. **Stop emitting** the event in code.
2. **Tag it `deprecated`** in Data Management.
3. **Unverify** it, so it drops out of filter dropdowns and stops being discoverable.
4. **Keep the action bridge** if the historical series still matters.

Definitions can be edited or deleted without touching ingested data — the data itself is permanent either way.

**Naming: keep the current convention** (snake_case `object_verb`). Renaming is impossible and there is no external canon to conform to — PostHog's own docs contradict themselves (`category:object_action` in one place, plain `[object][verb]` in another). Every source agrees on one thing only: consistency beats choice. Fix forward, and apply any new convention to *new* events only.

### Reserved property name: `surface`

**`surface` is a global super-property, not an event property.** The `before_send` scrubber at `src/lib/analytics/posthog-privacy.ts:162` writes it onto **every** event, unconditionally. Its values are `public` and `product`, derived from whether the path starts with `/dashboard`. `src/lib/analytics/posthog-queries.ts:20` filters owner-facing analytics on `equals(properties.surface, 'public')` — changing or removing the super-property breaks those dashboards.

DEV-1297 originally added a *per-event* `surface` property to `external_link_clicked` and `saved_brand_revisited`. Because the scrubber overwrites the key unconditionally, that per-event value would have been **silently destroyed before send**: the property would never have arrived in PostHog, and no test and no type check would have caught it. Found 2026-08-01 during dashboard construction, **before deploy — zero data was affected.** The properties were renamed to `link_surface` and `revisit_surface` respectively.

**Rule: `surface` is reserved. Never add a per-event property named `surface`.** Before naming any new property, check that the scrubber does not already write that key. The same applies to every other key the scrubber sets unconditionally: `analytics_schema_version`, `environment`, `locale`, `content_group`.

**The general lesson.** This is a property *collision*, a distinct failure mode from the property *type mutation* documented above. Both silently corrupt data, and neither is caught by TypeScript — the collision happens *after* the typed call site, inside the scrubber, so the call site type-checks perfectly while the value never survives to ingestion.

---

## Known data caveats

Read this section before drawing any conclusion from a chart.

### Found in the 2026-08-09 audit

- **`filterTestAccounts` excluded nobody for the project's first three weeks.** The app set person property `is_internal` (`src/lib/analytics/internal-users.ts`), while PostHog's setting matched cohort 426422 on `$internal_or_test_user`. The founder's person carried `is_internal = True` and `$internal_or_test_user = null`, and **0 of 4,106 post-launch founder events** matched either configured IP rule — so 66 of ~293 post-launch sessions were internal and counted everywhere. Cohort corrected 2026-08-09 to match either key, which is retroactive because membership is evaluated at query time; the code half is DEV-1408. **Effect on the headline:** a reported 25/346 = 7.2% "decision-grade" north star was really 19/228 = 8.3% and below the gate; brand-detail engagement rate moved from 52.1% to 74.4%.
- **DEV-1409 was a false-positive instrumentation finding.** The emit sites for `brand_claim_approved`, `brand_owner_edit_published`, and `saved_brand_revisited` are implemented, but no qualifying production action had occurred after DEV-1297 shipped on 2026-08-01. Production evidence checked 2026-08-09: 0 claim approvals since shipment (the one lifetime approval predates instrumentation), 0 saved brands total and 0 new saves, and 0 owner-edited brands since shipment. PostHog received 216 `brand_listing_published` events through the shared server SDK, confirming the server delivery path. All three events remain implemented but not yet production-observed; `Supply · Post-submission outcomes` stays off-dashboard until real volume validates them, not because of an instrumentation defect. DEV-1409.
- **`brand_listing_published` manufactures phantom persons.** It emits one synthetic identity per brand (`guest+<uuid>@guest.formoria.invalid`) — 209 distinct persons for 216 post-launch events — inflating every unique-people metric, and PostHog classifies them as `no_user_agent` bots. `e2e-user@test.local` also reaches production analytics. DEV-1410.
- **The submission funnel has no real user attribution.** All 108 form opens and 96 completions post-launch carry a single distinct_id, so it measures founder data entry, not supply. Parked off-dashboard. DEV-1411.
- **Search terms are captured from the DEV-1408 deploy forward.** Before it, only `query_length` / `has_results` / `result_count` existed, so no zero-result search before that date can be attributed to a missing brand or category. The privacy policy was updated in the same PR; `search_term` is dropped entirely when the query looks like an email address or a run of 7+ digits, and truncated at 100 characters.
- **`brands_published` in catalog coverage is a hardcoded, dated constant** (790, Supabase `brands.status='approved'`, 2026-08-09). PostHog has no warehouse connection to the brands table. Refresh it quarterly or the coverage percentage silently drifts optimistic as the catalog grows.

### Standing caveats

- **`user_logged_in` is inflated before 2026-08-01.** `GaUserSync` inferred a login from a client-side `null → user` transition, but `ViewerProvider` initializes as `{ user: null, loading: true }` and resolves asynchronously — so **every full page load while signed in looked identical to a login**, as did any transient auth error. Root-caused and fixed 2026-08-01 (the post-auth redirect now stamps `auth_event=login`; password sign-in stamps its own redirect; password *recovery* is deliberately excluded, since landing on the reset form is not a login). **Do not use `user_logged_in` data from before 2026-08-01 for anything**, including post-launch windows that straddle the fix.
- **`web_vital_reported` is machine-emitted and must be excluded from behavioural analysis.** It is the highest-volume event in the project by a wide margin and fires with no user intent. It must never enter a behavioural funnel, a session-qualification rule, or a raw-total comparison across events — anyone reading raw event totals without excluding it will reach a wrong conclusion about what users do. Tag it apart and confine it to performance work.
- **`brand_saved` had 0 post-launch events** (1 pre-launch, immediately followed by a `brand_unsaved` — the same test). Save behaviour is entirely unmeasured, so **the saves clause of the SDS numerator stays dormant until n≥30.** It is defined, not active.
- **`user_authenticated` overlaps `user_logged_in` / `user_signed_up`** and is a deprecation candidate. Do not use it for new analysis; when it is retired, follow the deprecation path above.
- **All pre-launch data is the founder's own clicking.** The earliest custom event is 2026-07-21; the product launched 2026-07-31 17:30 Asia/Taipei. Filter it out everywhere.
- **Autocapture is near-useless here.** Over 7 days it fired 161 times with `$el_text` null on 100% of them (`mask_all_text: true`). The elements chain survives, so CSS-selector matching works, but autocapture is a safety net for "did anyone click this at all," never a KPI foundation.

### Partial instrumentation — stated honestly

Two DEV-1297 items shipped narrower than the ticket title suggests. Both are deliberate, and both change what a chart means:

- **`result_count` shipped on `subcategory_filter_applied` only.** The subcategory chips already render a facet count, so the post-filter brand count is known at click time. `category_filter_applied` and `verification_filter_applied` have **no facet count available at click time** and therefore carry no `result_count`. Any "empty filter combination" analysis covers subcategories only.
- **`brand_card_clicked` excludes the recommendation-card variant.** Recommendation cards emit `recommendation_brand_clicked` instead. A card-click count that omits recommendations understates total in-product brand navigation; combine both events when the question is "how did visitors get to brand pages."

---

## Change log

| Date | Change |
|---|---|
| 2026-08-09 | DEV-1409 corrected: `brand_claim_approved`, `brand_owner_edit_published`, and `saved_brand_revisited` are implemented but not yet production-observed. Production had no qualifying actions after DEV-1297 shipped; the supply tile remains off-dashboard for volume and validation, not an instrumentation defect. |
| 2026-08-01 | Registry created (DEV-1298, in-repo half). Seeded from `docs/analytics/posthog-analytics-plan.md` §3, §4.1–4.5, §6.2, §6.5. SDS / referral rate / brand-detail engagement rate / catalog coverage restated from "not computable" to "instrumented; awaiting volume" following DEV-1297. |
| 2026-08-09 | **Dashboards consolidated 5 → 3 and the numbers underneath them corrected.** Boards are now **Formoria Dashboard** (1879718, business metrics, weekly, 9 tiles + a how-to-read banner), **Formoria · Behaviour** (1938057, biweekly), **Formoria · Diagnostics** (1937631, monthly). `Acquisition & Discovery` (1938056) and `Conversion & Supply` (1938055) were absorbed and deleted; 9 superseded insights deleted. The four `Site analytics — …` insights are **script-owned** by `scripts/posthog-sync.ts` (upsert-by-name from `OWNER_ENDPOINTS`) — leave them alone; deleting them is undone on the next `pnpm posthog:sync`, which also recreates a `Formoria — Site analytics` dashboard. Cohort 426422 corrected; all 15 remaining canonical HogQL insights given a post-launch floor plus `{filters}`; bot share rebuilt to split our own server emits from real crawlers; catalog coverage reworked onto the true 790-brand denominator; return-rate insight created. Dated project annotation added — **series before and after 2026-08-09 are not comparable.** Four defects filed: DEV-1408/1409/1410/1411. |
| 2026-08-01 | Canonical insights created in PostHog and linked from every entry above (retention deliberately excepted). 4+1 dashboard structure built by absorbing the two pre-existing dashboards rather than adding alongside them: **Pulse / North Star** (1879718, was "Formoria Product Analytics"), **Acquisition & Discovery** (1938056), **Engagement & Directory Behaviour** (1938057), **Conversion & Supply** (1938055), **[ops] Instrumentation Health** (1937631, was "Formoria Traffic", retains its DEV-1285 evidence tiles). Event Data Management hygiene applied: all 35 ingested events described and tagged; 25 verified, 10 deliberately left unverified (`web_vital_reported` machine-emitted, `user_logged_in` pre-fix data inflated, `user_authenticated` deprecated, plus 7 exploratory). `surface` property collision found and fixed pre-deploy — per-event `surface` on `external_link_clicked` / `saved_brand_revisited` renamed to `link_surface` / `revisit_surface`; see *Reserved property name: `surface`*. |
