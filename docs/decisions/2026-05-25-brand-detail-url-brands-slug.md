# ADR: Move brand detail pages to `/brands/[slug]`

Date: 2026-05-25

## Decision
Move brand detail pages from `app/[slug]/page.tsx` (root dynamic catch-all) to `app/brands/[slug]/page.tsx`. Add a 301 redirect from `/:slug` to `/brands/:slug` for SEO continuity.

## Context
DEV-659 moved brand detail pages to `/:slug` to create shorter URLs. This required a `RESERVED_ROUTES` set and slug validation in the brands service to prevent conflict between brand slugs and top-level routes (admin, api, auth, etc.). DEV-684 introduces a new landing page at `/`, making the root-level `[slug]` catch-all architecturally awkward alongside a static `page.tsx` at the same level.

## Alternatives Considered
- **Keep `/[slug]` (prior DEV-659 decision)**: Shorter URLs, no redirect needed. Rejected: the root-level dynamic catch-all at `/[slug]` conflicts with the new static `app/page.tsx` landing page in terms of route clarity. The middleware disambiguation problem doesn't go away — static routes win over dynamic, but adding new top-level pages always risks accidental slug conflicts.
- **Canonical at `/brands/[slug]`, also serve `/[slug]`**: Best of both URL lengths. Rejected: adds a redirect layer for every brand page load, creates two valid URLs per brand (canonical vs served), increases redirect complexity with no material SEO benefit over a clean single 301.

## Rationale
`/brands/[slug]` creates a clear URL hierarchy matching the site's information architecture: `/brands` (directory) → `/brands/[slug]` (detail). It eliminates the need for `RESERVED_ROUTES` slug disambiguation at routing time — static Next.js routes under `app/` already take precedence over dynamic ones, but the `[slug]` catch-all at root would remain a footgun for any new top-level pages added in the future. Moving to `/brands/[slug]` removes this concern entirely.

The 301 redirect from `/:slug` preserves SEO equity from any pages Google has already indexed at the short URLs.

## Consequences
- Advantage: No root-level dynamic catch-all — any new top-level pages are unambiguous
- Advantage: `RESERVED_ROUTES` validation in the brands service can be simplified (no routing-time disambiguation needed)
- Advantage: Clear URL hierarchy consistent with the directory move
- Disadvantage: Longer brand URLs (`/brands/[slug]` vs `/:slug`)
- Disadvantage: Reverses DEV-659 permanent 301 redirects — Google will need to recrawl and update indexed URLs
- Disadvantage: Requires updating `sitemap.ts`, `json-ld.ts`, and E2E tests that hardcode `/${slug}` patterns
