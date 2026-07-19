# Personal OS Executive Contract Plan

## Scope

Provide Personal OS with a stable, authenticated executive projection without coupling it to Formoria `/admin` UI or leaking provider types.

The contract includes approved-brand and confirmed-subscriber movement, claimed share, local brand/destination rankings, curation-worker health, and cached customer-facing system status. Public analytics stay in GA4 and are exported through the existing Growth Pulse routine.

## Implementation

1. Move GA initialization to a route-aware public analytics component, disable automatic page views, and block protected and localized protected paths.
2. Correct search event semantics and remove the duplicate custom session-start tracker.
3. Expand the Apps Script and Agent Hub payload with a versioned executive section using complete GA4 windows ending at T-2.
4. Add a customer-facing health service outside `/admin`, with five-minute caching, explicit refresh, sanitized provider messages, and structured audit records.
5. Add constant-time bearer authentication and `no-store` internal GET/refresh routes. Authenticate before any service or database call.

## Verification

- Regression tests for protected-path analytics and search event ordering.
- Contract tests for window boundaries and additive Agent Hub payloads.
- Unit tests for health cache/partial failure/auditing and executive calculations.
- Route tests proving authentication precedes data access and responses are not cached.
- Lint, build, and changed-route/test-drift checks.

## Dependency note

The executive integration is rebased onto the admin-ops redesign merged on 2026-07-19. Executive services remain outside `/admin` and depend only on stable service interfaces, preserving the boundary between Personal OS reporting and Formoria operations.
