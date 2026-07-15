# Claude Routine Configuration

The four analysis agents remain Claude Routines so they continue to use the Claude subscription. Their saved prompts are bootstraps only; the versioned prompt files in this repository are authoritative.

## Common configuration

- Repository: `ytchou/Formoria`
- Branch: default branch, refreshed at the start of every run
- Environment variables: `AGENT_HUB_INGEST_URL`, `AGENT_HUB_INGEST_TOKEN`
- Network allowlist: the Agent Hub Supabase function host
- Do not configure `AGENT_HUB_SERVICE_KEY` or `ANTHROPIC_API_KEY`

Use this saved prompt, replacing the file name for each routine:

```text
Open a fresh checkout of the default branch of ytchou/Formoria. Read docs/routines/<routine>-prompt.md and follow it exactly. That repository file is the source of truth; do not use remembered delivery instructions. Always run its Agent Hub delivery step, including after a data-source failure.
```

## Routines

| Routine | Schedule (Asia/Taipei) | Prompt file | Required connectors or secrets |
|---|---:|---|---|
| Directory Health | Daily 07:00 | `docs/routines/directory-health-prompt.md` | Formoria Supabase, GitHub, Linear, Web Search |
| Sentry Triage | Daily 07:00 | `docs/routines/sentry-triage-prompt.md` | Sentry |
| Mention Tracker | Daily 07:00 | `docs/routines/mention-tracker-prompt.md` | Google Drive, Web Search, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MENTION_TRACKER_SHEET_ID` |
| Growth Pulse | Daily 07:10 | `docs/routines/growth-pulse-prompt.md` | Google Drive, Linear |

Mention Tracker's Google credentials belong only in that routine's environment. Keep the common Agent Hub token identical across all four routines and GitHub Actions so rotation is one coordinated operation.

## Cutover check

After the Agent Hub migration and Edge Function are deployed and the Formoria producer change is merged:

1. Update each saved prompt and its environment.
2. Use `Run now` once for each routine.
3. Confirm one row per routine for the logical Asia/Taipei date in Personal OS.
4. Replay one output and confirm no duplicate row appears.
5. Remove obsolete service-role and relay configuration only after all four deliveries succeed.
