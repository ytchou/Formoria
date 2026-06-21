# ADR: Daily Scheduled Sentry Triage

Date: 2026-06-21

## Decision
Implement daily scheduled error triage via a Claude Code Routine, superseding the 2026-06-12 ADR that chose on-demand Sentry sync.

## Context
The 2026-06-12 ADR rejected cron-based Sentry operations at pre-launch scale. Post-launch, errors are escalating unnoticed (PGRST103: 14 events, PGRST205: 12 events in one week). Manual triage doesn't catch issues early enough.

## Alternatives Considered
- **Continue on-demand**: Rejected — doesn't scale; errors pile up between manual checks.
- **pg_cron + API route**: Rejected — can't access Sentry MCP tools or Seer AI analysis.

## Rationale
Post-launch error volumes justify daily automated triage. The existing pg_cron precedent (2026-05-18 ADR for Edge Function triggers) shows scheduled infrastructure is already accepted.

## Consequences
- Advantage: Errors caught within 24 hours, every day
- Advantage: Phase progression (read-only → auto-ticket → auto-PR) without new infrastructure
- Disadvantage: Depends on Claude Code Routine infrastructure availability
