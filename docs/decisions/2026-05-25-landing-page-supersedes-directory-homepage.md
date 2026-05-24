# ADR: Introduce dedicated landing page at `/`, move directory to `/brands`

Date: 2026-05-25

## Decision
Supersede `2026-05-19-homepage-is-brand-directory`. Create a new marketing landing page at `/` with a Faire-inspired mission+discovery design. Move the brands directory from `app/page.tsx` to `app/brands/page.tsx`.

## Context
Founder direction (DEV-684) calls for a proper marketing entry point inspired by faire.com — a polished landing page that communicates the MIT Map mission before users enter the directory. The prior ADR optimised for the shortest path to content; this decision trades that for brand storytelling and a clearer information hierarchy.

## Alternatives Considered
- **Hybrid: enhance the homepage with a hero above the grid**: Keep directory at `/`, add hero section at top. Rejected: doesn't create a distinct marketing surface, clutters the browse experience, and mixes discovery intent with brand messaging on the same page.
- **Keep directory-as-homepage (prior ADR)**: No change. Rejected: founder direction explicitly calls for a landing page; the product has matured to a point where onboarding new users with context is worth the extra click.

## Rationale
MIT Map's mission (celebrating Taiwanese-made brands) is not self-evident from a raw grid of brand cards. A landing page surfaces the "why" before the "what", which improves conversion from first-time visitors who don't yet understand the product. Faire's pattern — tagline + values navigation + discovery path — is directly applicable.

Moving the directory to `/brands` also enables a cleaner URL hierarchy: `/` (landing) → `/brands` (directory) → `/brands/[slug]` (detail), which is more legible than the prior flat structure.

## Consequences
- Advantage: Clear information hierarchy with a proper marketing entry point
- Advantage: SEO — homepage can carry keyword-rich mission copy, separate from the brand grid
- Advantage: Route structure is simplified (see `2026-05-25-brand-detail-url-brands-slug.md`)
- Disadvantage: One extra click for returning users to reach the directory (mitigated by nav link)
- Disadvantage: Requires updating 6 E2E test files referencing the old `/` as the directory
- Disadvantage: Reverses DEV-659's permanent 301 redirects — SEO transition period expected
