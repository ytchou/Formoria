# Claude Routine Configuration

A single unified "Formoria Health Agent" routine runs all three health checks (Directory Health, Sentry Triage, Growth Pulse) sequentially in one session. The versioned prompt file in this repository is authoritative; the saved prompt in Claude Routines is a bootstrap only.

## Configuration

- Repository: `ytchou/mitmap`
- Branch: default branch, refreshed at the start of every run
- Environment variables: `AGENT_HUB_INGEST_URL`, `AGENT_HUB_INGEST_TOKEN`, `PERSONAL_OS_INTERNAL_TOKEN`, `FORMORIA_RAILWAY_URL`
- Network allowlist: the Agent Hub Supabase function host, the Formoria Railway direct host
- Do not configure `AGENT_HUB_SERVICE_KEY` or `ANTHROPIC_API_KEY`

Saved prompt:

```text
Open a fresh checkout of the default branch of ytchou/mitmap. Read docs/routines/formoria-health-prompt.md and follow it exactly. That repository file is the source of truth; do not use remembered delivery instructions. Always run its Agent Hub delivery step for each section, including after a data-source failure.
```

## Routine

| Routine | Schedule (Asia/Taipei) | Prompt file | Required connectors |
|---|---:|---|---|
| Formoria Health Agent | Daily 07:10 | `docs/routines/formoria-health-prompt.md` | Formoria Supabase, GitHub, Linear, Sentry |

Google Drive MCP is no longer needed for any section — Growth Pulse (Section 3) now reads the PostHog analytics endpoint directly via `FORMORIA_RAILWAY_URL` with `PERSONAL_OS_INTERNAL_TOKEN` bearer auth.

Web Search is no longer needed for link or image health checks — Section 1 now reads link status from the `link_check_results` table populated by the background link-checker workflow.

Keep the Agent Hub token identical across this routine and GitHub Actions so rotation is one coordinated operation.

## Configuration surfaces

All automation surfaces that feed the health pipeline, with their triggers and required configuration:

| Surface | Trigger | Where configured | Required secrets / vars |
|---|---|---|---|
| Formoria Health Agent | Claude Routines, daily 07:10 Taipei | Claude Routines UI (saved prompt bootstrap) | Env vars listed under Configuration above |
| link-checker | pg_cron job `link-health-daily`, daily 06:20 Taipei (`20 22 * * *` UTC) → `POST /api/cron/link-health` | Migration `supabase/migrations/20260721200005_link_health_cron.sql`; `app_secrets` for the origin secret | Railway env: `ORIGIN_SECRET`, `AGENT_HUB_INGEST_URL`, `AGENT_HUB_INGEST_TOKEN` |
| health-selfheal | GitHub Actions cron `10 0 * * *` (08:10 Taipei) + `workflow_dispatch` (dry_run default true) | `.github/workflows/health-selfheal.yml` | Repo var `HEALTH_SELFHEAL_ENABLED` (gate); secrets `SELFHEAL_PAT`, `CLAUDE_CODE_OAUTH_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

Ordering note: the link-checker runs at 06:20 so its `link_check_results` rows are fresh when the Health Agent's read-back phase runs at 07:10; health-selfheal picks up `health_fix_queue` rows at 08:10 after Section 2 has queued them.

## Tables written by the routine

The routine now writes to two tables on each run (in addition to reading from `link_check_results`):

| Table | When written | Purpose |
|-------|-------------|---------|
| `health_snapshots` | Section 1, daily | Trend upsert of quality metrics; compared against yesterday's row to report deltas |
| `health_fix_queue` | Section 2, after classification | Queues Trivial Sentry issues for the automated fix workflow; loop closure resolves fixed rows in Sentry |

## Cutover from three separate routines

1. Delete the three old routines (Directory Health, Sentry Triage, Growth Pulse) from Claude Routines.
2. Create one new routine "Formoria Health Agent" with the configuration above.
3. Use `Run now` once.
4. Confirm three rows appear in Personal OS Agent Hub (one per check: `directory-health`, `sentry-triage`, `growth-pulse`) for the logical Asia/Taipei date.
5. Replay one output and confirm no duplicate row appears.
6. Archive prompts are in `docs/routines/archive/` for reference.

## MANUAL CUTOVER REQUIRED — saved prompt in Claude Routines UI

The saved prompt stored in the Claude Routines UI still references `ytchou/Formoria`. An operator must manually edit that saved prompt in the Claude Routines UI to replace `ytchou/Formoria` with `ytchou/mitmap`. The prompt in this file is already correct; only the UI-stored copy needs updating.
