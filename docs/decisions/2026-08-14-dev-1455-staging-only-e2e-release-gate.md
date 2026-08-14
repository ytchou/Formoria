# ADR: DEV-1455 staging-only E2E and release gate

Status: accepted

## Context

Production-targeted synthetic checks and local replay made a green run depend
on live production data, external email delivery, or a locally built server.
The staging deployment now has its own Supabase project and can provide the
deterministic public fixture and private QA accounts required by the complete
suite.

## Decision

Use the deployed staging origin and project as the only E2E target. Ordinary
`staging` pull requests do not run E2E. The complete deep/mobile suite runs
nightly, manually, and as a fresh check on every `staging -> main` release PR.
Each run checks out the current staging SHA and requires `X-Formoria-Revision`
from Railway to equal that SHA.

Auth signup and recovery use a staging-only Send Email Hook that captures a
namespaced recipient and token hash in an RLS-protected table. The hook is
invoker-rights and never sends externally. Tests follow the captured Auth URL
and delete the capture and temporary user.

Self-heal is staging-only. Exact/full verification and self-merge are allowed
only for test-only `e2e/**/*.ts` repairs into `staging`; any `src/**` repair is
`review_ready` because an undeployed application change cannot be certified by
the currently deployed staging revision. Infrastructure retries, independent
review, one incident PR, and one initial/terminal notification remain bounded.

## Consequences

Staging must be seeded and its external Cloudflare/Railway/GitHub settings must
be correct before the release gate can certify. Missing revision evidence or a
cross-wired URL blocks rather than silently testing stale data. Production
schema migration behavior is unchanged; the capture hook is not configured in
production.

## Pre-mortem

The fatal assumption is reliable deployed-revision evidence. The workflow
therefore rejects a missing header and records both app and test SHAs. Silent
failures are cleanup errors, skipped tests, production credentials, and
release checks against a different staging head; each is an explicit gate.
