# ADR: PostHog Analytics Hub and Managed Proxy

Date: 2026-07-20

Status: Accepted for implementation; production launch requires legal and data validation

## Decision

PostHog is Formoria's sole queried analytics source. Browser capture uses PostHog's managed `e.formoria.com` proxy, and server-side Query API access remains inside Formoria. GA4 stays installed and collecting unchanged for possible future Google Ads use, but application code no longer queries or transports GA4 data.

Personal OS receives versioned, provider-neutral business and analytics projections through authenticated, `no-store` routes. The brand-owner dashboard uses the same PostHog session contract after `requireBrandEditor` authorizes the requested brand.

This decision supersedes the GA4-only Growth Pulse reporting direction, local brand-analytics storage as a reporting source, and the previous combined Personal OS executive projection.

## Constraints

- Public windows use `Asia/Taipei` and end yesterday.
- Event capture is production-only and has no direct PostHog ingestion fallback.
- Protected, API, and framework-internal paths are excluded. Sensitive text, form values, direct identifiers, and authentication material must never be sent.
- Authenticated users may be identified only by stable Supabase UUID. Logout resets the PostHog identity.
- PostHog IP retention, replay, page-leave, exception, performance, and rage-click capture remain disabled.
- Formoria owns the PostHog personal API key and audits each Query API request and sanitized response.

## Rollout gates

The legacy executive endpoint, local analytics tables/functions, and Growth Pulse artifacts are retained until production proves all of the following:

1. `e.formoria.com` is live as a DNS-only managed-proxy CNAME and browser ingestion succeeds without a CSP violation.
2. Sampled events contain the required session, schema, surface, and immutable brand identifiers, with no protected paths or sensitive identifiers.
3. GA4 DebugView still receives its existing public event contract.
4. Query totals reconcile with saved PostHog insights for identical dates and filters.
5. Personal OS correctly shows current totals, partial failures, and incomplete comparison baselines.
6. The updated English and Traditional Chinese privacy policy receives legal review.

After those gates pass, a forward migration may record row counts and drop only the approved local analytics tables/functions. Growth Pulse automation may then be disabled and archived while historical Agent Hub runs and their renderer remain readable.

## Failure mode

The assumption that invalidates the dashboard is that captured events carry a stable `$session_id` plus valid schema and brand identifiers. Silent failures are most likely at managed-proxy DNS, CSP, path filtering, or semantically incorrect HogQL boundaries, so production network inspection and saved-insight reconciliation are mandatory rather than optional rollout checks.
