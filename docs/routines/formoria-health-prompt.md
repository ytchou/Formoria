# Formoria Health Agent — Claude Routine Retirement Tombstone

This source-of-truth prompt is intentionally a no-op. The Claude Routine is retired and must not collect data, mutate state, create tickets, deliver reports, or schedule itself.

GitHub Actions owns Formoria health automation through [`.github/workflows/health-agent.yml`](../../.github/workflows/health-agent.yml). Its only active collector routine names are `link-checker`, `directory-health`, and `sentry-triage`. Growth Pulse is retired.

The final Claude Routine prompt is preserved verbatim at [`archive/formoria-health-prompt-claude-routine.md`](archive/formoria-health-prompt-claude-routine.md) for audit and rollback only. Re-enabling it requires the documented rollback gate: disable both GitHub health variables and GitHub App writes before restoring the archived prompt and rescheduling the legacy link cron.
