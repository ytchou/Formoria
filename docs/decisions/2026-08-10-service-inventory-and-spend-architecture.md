# Service inventory and spend architecture

**Date:** 2026-08-10
**Status:** Accepted
**Tickets:** DEV-1375 (parent) → DEV-1420 / DEV-1421 / DEV-1422
**Context:** `/brainstorming` session; plan at `~/.claude/plans/wobbly-churning-eagle.md`

> Local decision record. Per project convention, ADRs are not committed.

## Context

Formoria depends on ~22 external services and has no inventory of them — not in code, not in docs, not in a dashboard. On 2026-08-07 that gap produced an outage (DEV-1374): Supabase Storage Image Transformations reached 14,701 against an included quota of 100, and the first signal was the site returning Cloudflare 522s. Every other paid provider carries the same blind spot, differing only in whether the consequence is an outage or an invoice.

Three questions had to be answered together: *what am I running*, *is it working*, and *what does it cost*.

## Decision

**A checked-in service registry is the spine.** `src/lib/services/service-registry.ts` holds one typed entry per service — criticality, env vars, plan price with an `asOf` date, quota lines with their own cycle-reset day, and an optional meter. Health and spend both key off it.

**Cost is budget-accurate, not invoice-accurate**, and every figure carries a provenance tier — `declared`, `derived`, `reported`, `unmetered` — which never silently merge. There are zero `reported` entries at launch. The headline is deliberately not a single number: `Declared fixed $X/mo · Derived MTD $Y · N unmetered · M unpriced`.

**A standalone CI guard keeps the registry honest.** `scripts/check-service-registry.mjs` fails when a credential-shaped `process.env.X` exists without a registry entry or an explicit allowlist reason. This, not the dashboard, is the load-bearing artifact — it is what prevents the inventory from rotting.

**Alerting runs outside Formoria**, in GitHub Actions, reaching `POST /api/cron/spend-snapshot` with `ORIGIN_SECRET`. Thresholds are 60% / 85% of quota, plus a burn-rate rule: over 3× the 7-day median is a spike regardless of absolute dollars.

## Why the burn-rate rule exists

DEV-1374 was 147% of quota on day one but only about $5 of overage. A design that alerts on absolute spend reproduces the original blind spot exactly. Percentage-of-quota and rate-of-change are the signals; dollars are a secondary column.

## Consequences

- Plan prices are hand-maintained and go stale. Mitigated by rendering `asOf` beside every declared figure and failing the guard at 180 days.
- Eval and model-A/B LLM spend is structurally invisible: `CURATION_EVAL_SINK` diverts `insertAiCallResult` to JSONL, and `scripts/model-ab/run.ts` also installs `setAuditWriteSeam`. Declared as a standing blind spot rather than silently absorbed.
- `cost_usd IS NULL` means unpriced, not free — reported as an explicit `unpricedCalls` count.
- `service_spend_daily` establishes a rollup-table pattern that does not yet exist in this repo.
- The spend surface cannot be e2e-tested: `playwright.config.ts:43` pins `FORMORIA_INTERNAL_TOKEN` to `""`.

## Amendment — 2026-08-10, during DEV-1421 design

Three statements above are superseded by evidence gathered against prod.

**`cost_usd IS NULL` has three meanings, not one.** The consequence above says it
"means unpriced, not free." Measured: it also means *not an API call at all*
(verdict rows from `insertTriageResult` / `insertReputationResult`, which record a
phase's decision and carry no `raw_response`) and *a call that never reached
inference* (HTTP 429/400 — genuinely $0). Only the third meaning is a real
undercount. Restricted to real successful calls, `gpt-5.6-luna` is **100% priced
every day since the cost migration**. The `unpricedCalls` field stays, now as a
coverage signal reading 0, not a correction factor.

**`service_spend_daily` moves to DEV-1422.** Its only consumer is the burn-rate
rule. Designing its columns before that rule's queries exist is guesswork, and
`external_call_audit`'s 180-day retention means no history is lost meanwhile.

**The snapshot needs an explicit coverage block.** `external_call_audit` has no
cost column, so non-LLM dollars are *inferred* (Serper/Resend: counts × registry
unit price) or *absent by construction* (scraper, Playwright, http, turnstile,
mit-registry, posthog). "Unmetered shown explicitly" becomes a structural field
rather than a footnote, so the endpoint cannot be misread as total spend.

One rejected alternative is also worth recording: a static test enumerating
`LLM_PROFILES` to prove every model has a price row. Rejected — all 15 profile
keys resolve to one model string, and three runtime escape hatches
(`OPENAI_MODEL_OVERRIDE`, caller `options.model`, free-form `input.model`) put the
true set beyond static reach. The guard asserts `Object.values(LLM_MODELS)` as a
seed floor; the runtime `pricingCoverage` ratio is the real backstop.

## Amendment — 2026-08-11, during DEV-1422 design

The alerting half of this ADR is **withdrawn, not deferred**. Measured against
prod, the decision above ("thresholds are 60% / 85% of quota, plus a burn-rate
rule: over 3× the 7-day median is a spike regardless of absolute dollars") does
not fit this system at its current stage.

**The burn-rate rule would have been a false-positive generator.** `external_call_audit`
began collecting 2026-08-04, so only 7 days of history exist and the rule could
not fire at all for a week. Worse, the workload is batch-driven rather than
steady — daily `openai` spans ran 8 → 121 → 254 → 357 → 6 → 0 — so the rule
would have fired on 08-06, 08-07 and 08-08, every one of them a curation batch
the operator started deliberately. All traffic is currently the operator's own,
which makes every true positive a restatement of something they already know.

**The quota thresholds have nothing to defend.** Serper sits at 311/2,500 on a
flat $50 subscription; Resend at 14/3,000 with `overageUsdPerUnit: 0`. Only 2 of
23 registry services carry a meter. The single line that varies with usage is
LLM, at **$6.72 cycle-to-date** against a ~$75/mo fixed base.

DEV-1422 therefore ships a **daily spend report to Slack**, not an alerter: the
operator is the detector, and the job's duty is to put the number in front of
them each morning. Delivery failure is the only alert — if the origin is
unreachable, that is itself the signal, which is why the runner stays outside
Formoria.

**"Why the burn-rate rule exists" above still holds as reasoning** — percentage
of quota and rate of change beat absolute dollars, and that is why the report
leads with units and coverage rather than a single total. It is the *timing*
that was wrong: those rules need organic traffic and a variable line big enough
to defend. Re-file them when both exist.

**`service_spend_daily` is cancelled, not moved again.** Its two jobs were
surviving the audit purge and feeding the burn-rate rule. The rule is gone, and
`20260805170000_audit_retention.sql` purges only `external_call_audit` (180d) and
`admin_audit_log` (90d) — `brand_ai_results` is never purged, so LLM cost history
is permanent. A daily report never reaches back far enough to need a rollup, and
Slack is the archive. The consequence above ("establishes a rollup-table pattern
that does not yet exist in this repo") no longer applies: **DEV-1422 ships no
migration.**

## Amendment — 2026-08-11, during tier-aware provider health design

The health contract now makes registry criticality meaningful instead of
treating every probe failure as an incident. The 13 executive probes continue
to use the version 1 `system-status` shape. A `down` customer-critical service
sets the overall status to `critical`; any unhealthy customer-critical or
customer-flow service sets it to `warning`; back-office failures and
unconfigured back-office probes are informational and never change the overall
status. Every executive check ID and tier is checked against the registry, and
Sentry is explicitly back-office because its authenticated organization read is
an operational observability check rather than a customer request path.

The MIT Registry probe reads only the local `mit_registry` mirror. It is
healthy when the mirror is populated and its newest `synced_at` is within the
shared **192-hour** weekly-sync budget; an old or invalid timestamp is
`degraded`, while an empty mirror or query failure is `down`. The same constant
drives cron health's `sync-mit-registry-weekly` stale threshold, preventing the
two operational surfaces from disagreeing about freshness.

Turnstile health uses the Siteverify response body, not HTTP reachability alone:
only the expected `missing-input-response` result with an accepted secret is
healthy. Invalid or missing secrets, malformed JSON, provider errors, and
transport failures are down. Sentry's health configuration is the bearer-token
authenticated organization probe and remains separate from Sentry's DSN;
PostHog's message names its query probe. Human service names in the health
payload remain distinct from stable audit-provider labels (`mit-registry`,
`turnstile`, and so on), so display copy cannot change audit aggregation.

## Alternatives considered

- **Provider-API collector first** (fetch usage from Supabase, Railway, PostHog, Sentry). Rejected: five integrations, five auth schemes, five cycle boundaries, and nothing ships until the first works. Supabase's docs point only at the dashboard usage page — no Management API usage endpoint is documented. Deferred as DEV-1375d, gated on that question.
- **Alert-only, no inventory.** Rejected: a hardcoded list of *known* risks, when DEV-1374 was an unknown one. It is also a strict subset of DEV-1422.
- **A new `'unprobed'` health status.** Rejected: `classifyExecutiveHealth:84` and personal-os `deriveFormoriaAttentionItems:74` are both `status !== 'healthy'` filters, so it would pin overall status at `warning` permanently and flood the attention list.
- **Image-transformation call-site counter.** Rejected: DEV-1374's guard landed and there are zero live callers of `/storage/v1/render/image`; it would count zero forever.
- **Coverage check as a vitest only.** Rejected: PR CI runs `vitest --changed HEAD~1`, so it would never fire on the PR that adds a new provider.
- **Runtime-editable registry in a Supabase table with an admin UI.** Rejected: nothing can assert coverage against a DB table, which defeats the only anti-rot mechanism.
- **Playwright-scraping provider dashboards.** Rejected: eight sets of dashboard credentials in CI is a worse posture than the problem.
- **A single aggregate monthly total.** Rejected: a 100× on a $2 line is invisible inside a $60 total.
- **Computing alerts inside a Next cron route.** Rejected: muted by the very outage class it exists to catch.

## Amendment — 2026-08-11, during Formoria health operational sections design

The registry now carries an explicit operational classification alongside
criticality. `operationalSection` is one of `production`, `back-office`,
`agents`, `deprecated`, or `null`; `operationalKind` is one of `dependency`,
`worker`, or `alert`. The classification is source-owned and remains required
for every entry, including entries that are not shown in the Personal OS
inventory.

The previous amendment's 13-probe count is superseded: the current executive
health set has 11 probes after removing Linear and GitHub, whose registry rows
remain governed but hidden from this operational projection.

The `system-status` version 1 inventory projection includes only the four
visible sections and adds these fields without changing spend or Agent Hub
schemas. The null-section entries remain in `SERVICE_REGISTRY` for credential
coverage and spend governance, but are omitted from the consumer payload.
Personal OS owns the presentation order and joins live health by stable
service ID. Linear and GitHub are inventory-only and no longer executive
health probes because their checks do not represent a customer-facing or
back-office operational dependency in this view.

The Agents section is a combined operational view: registry-owned Slack
alerts and the Railway curation worker are shown with active Formoria Agent
Hub definitions. Agent Hub definitions remain source-owned and are read with
their latest run in one embedded-relation query; a missing run is visible as
unavailable rather than inferred as a failure. An Agent Hub read failure is
local to that section, so dependency and deprecated sections remain usable.
