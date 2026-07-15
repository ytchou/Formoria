# ADR: Static public rendering with client viewer state

**Date:** 2026-07-15  
**Status:** Accepted

## Context

The shared localized layout reads authentication and impersonation cookies, and brand detail pages read request query parameters and viewer state. Next.js therefore classifies all localized pages, including brand details, as dynamic and production responses are private and non-cacheable.

## Decision

Keep all public content and SEO metadata request-independent and move viewer-specific state to a root client provider backed by server-verified actions. Remove the unused query-based draft preview and let analytics read source attribution in the browser. Brand detail pages use static generation with one-hour ISR.

## Consequences

- Crawlers receive complete, cacheable brand HTML without depending on a live session lookup.
- Viewer controls appear after hydration and require a stable loading placeholder.
- Authorization remains server-side; client viewer state affects visibility only.
- Public mutations must invalidate both locale variants and the sitemap.
