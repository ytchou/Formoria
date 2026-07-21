# Claude Routine Configuration

A single unified "Formoria Health Agent" routine runs all three health checks (Directory Health, Sentry Triage, Growth Pulse) sequentially in one session. The versioned prompt file in this repository is authoritative; the saved prompt in Claude Routines is a bootstrap only.

## Configuration

- Repository: `ytchou/Formoria`
- Branch: default branch, refreshed at the start of every run
- Environment variables: `AGENT_HUB_INGEST_URL`, `AGENT_HUB_INGEST_TOKEN`, `PERSONAL_OS_INTERNAL_TOKEN`, `FORMORIA_RAILWAY_URL`
- Network allowlist: the Agent Hub Supabase function host, the Formoria Railway direct host
- Do not configure `AGENT_HUB_SERVICE_KEY` or `ANTHROPIC_API_KEY`

Saved prompt:

```text
Open a fresh checkout of the default branch of ytchou/Formoria. Read docs/routines/formoria-health-prompt.md and follow it exactly. That repository file is the source of truth; do not use remembered delivery instructions. Always run its Agent Hub delivery step for each section, including after a data-source failure.
```

## Routine

| Routine | Schedule (Asia/Taipei) | Prompt file | Required connectors |
|---|---:|---|---|
| Formoria Health Agent | Daily 07:10 | `docs/routines/formoria-health-prompt.md` | Formoria Supabase, GitHub, Linear, Web Search, Sentry |

Google Drive MCP is no longer needed for any section — Growth Pulse (Section 3) now reads the PostHog analytics endpoint directly via `FORMORIA_RAILWAY_URL` with `PERSONAL_OS_INTERNAL_TOKEN` bearer auth.

Keep the Agent Hub token identical across this routine and GitHub Actions so rotation is one coordinated operation.

## Cutover from three separate routines

1. Delete the three old routines (Directory Health, Sentry Triage, Growth Pulse) from Claude Routines.
2. Create one new routine "Formoria Health Agent" with the configuration above.
3. Use `Run now` once.
4. Confirm three rows appear in Personal OS Agent Hub (one per check: `directory-health`, `sentry-triage`, `growth-pulse`) for the logical Asia/Taipei date.
5. Replay one output and confirm no duplicate row appears.
6. Archive prompts are in `docs/routines/archive/` for reference.
