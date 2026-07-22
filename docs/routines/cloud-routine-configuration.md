# Formoria Health Agent Configuration and Cutover

GitHub Actions is the intended owner of Formoria health automation. There is no active Claude Routine configuration in this repository. The former prompt is a retirement tombstone, and its last complete contents remain in [`archive/formoria-health-prompt-claude-routine.md`](archive/formoria-health-prompt-claude-routine.md) for audit and rollback only.

The target workflow is [`.github/workflows/health-agent.yml`](../../.github/workflows/health-agent.yml), scheduled best-effort for 07:00 Asia/Taipei (`0 23 * * *`). It emits exactly three Agent Hub collector routines: `link-checker`, `directory-health`, and `sentry-triage`. Growth Pulse and traffic correlation are retired.

## Rollout gates

No external cutover is claimed complete until all gates below pass in order:

1. **Preflight:** dispatch `health-agent.yml` in `preflight` mode. Exercise link, Directory, and sanitized production Sentry reads, Claude schema validation, Agent Hub delivery, and Slack delivery. Keep Linear writes, queue claims, branch cleanup, repair PR creation, and all other business mutations disabled.
2. **GitHub App canary:** create one harmless App-authored canary PR. Confirm required checks run, auto-merge completes, the authoritative merge SHA matches a successful Railway production deployment, and `GET /api/health` succeeds.
3. **Cutover:** only after both gates pass, enable `HEALTH_AGENT_ENABLED` and `HEALTH_AUTOFIX_ENABLED` while disabling the external Claude Routine in the same window. Run the integrated link collector successfully before manually unscheduling `link-health-daily`.
4. **Acceptance:** confirm the next 07:00 run delivers one row for each collector and one complete Slack digest. Confirm the 08:30 watchdog detects a deliberately missing or stale test run. Then remove the external Claude Routine; there is no shadow period.

## Rollback gate

Disable `HEALTH_AGENT_ENABLED`, `HEALTH_AUTOFIX_ENABLED`, and GitHub App writes first. Reschedule the existing link cron. Restore the archived Claude prompt only if a temporary Routine rollback is necessary; never run both writers concurrently.

## Configuration ownership

Repository secrets and variables are declared by name in `.env.example` and validated locally only when `scripts/doctor.sh --health-preflight` or `scripts/doctor.sh --health-live` is requested. Credentials remain in GitHub/Railway configuration and must never be copied into documentation, logs, Claude evidence, or repository files.
