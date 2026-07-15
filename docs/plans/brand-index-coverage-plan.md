# Brand Index Coverage Plan

1. Add regression tests for brand locale eligibility, reciprocal sitemap entries, metadata robots behavior, viewer-state hydration, analytics source parsing, and public cache invalidation.
2. Add a root viewer provider; remove request-bound auth and impersonation reads from the localized layout; extend existing viewer controls to consume the provider.
3. Remove public query preview, move source attribution client-side, and make brand details force-static with one-hour ISR.
4. Add a lightweight brand SEO projection and shared locale eligibility policy. Emit one sitemap entry per eligible locale, use real timestamps, and gate untranslated guide variants.
5. Centralize invalidation for brand detail variants, listings, home, and sitemap; remove saved-brand global layout revalidation.
6. Verify scoped tests, lint, e2e drift, production build route classification, and production response headers.
7. Dry-run targeted description enrichment for the two English-ineligible approved brands. Execute only after the dry run confirms protected content is untouched and validation passes.
