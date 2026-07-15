# SEO Index Coverage Design

## Goal

Make every substantive approved brand page easy for search engines to discover, crawl, and index without letting viewer-specific authentication state make public HTML dynamic.

## Fixed decisions

- Public brand content, metadata, structured data, and locale links are static HTML with one-hour ISR.
- Authentication, ownership, admin controls, pending claims, and impersonation hydrate through one nonvisual client provider.
- Every approved brand with a description is indexable in Chinese.
- English is indexable only when both English description and blurb exist and meet the existing 95% English-purity threshold.
- Ineligible locale pages remain usable at `200` with `noindex,follow`, but are absent from the sitemap and reciprocal hreflang sets.
- The unused `?preview=1` branch is removed from the canonical public route.
- Each eligible localized URL gets its own sitemap `<loc>` entry with reciprocal alternates and accurate modification dates.
- Genuine historical 404s and intentional admin/auth exclusions are not redirected merely to reduce Search Console exclusions.

## Viewer-state boundary

The root client provider owns the Supabase browser auth subscription and obtains server-verified viewer context. It exposes only an internal user identity plus `hasOwnedBrand`, `isAdmin`, and optional impersonation display data. Brand-specific pending-claim state is loaded separately. Server actions remain the authorization boundary.

Existing navigation, account, claim, admin-menu, and impersonation components consume the provider. No new visual component is introduced.

## SEO behavior

Eligible locale pages are self-canonical and list identical reciprocal hreflang alternates. An ineligible English page is self-canonical and `noindex,follow`; its Chinese counterpart does not advertise it. Guide alternates follow their actual frontmatter locale.

Sitemap timestamps use brand `updated_at` and guide frontmatter dates. Static pages omit unverifiable timestamps. Google-ignored `priority` and `changeFrequency` values are removed.

## Success criteria

- `/[locale]/brands/[slug]` is reported as SSG/ISR by a production build.
- Eligible public brand responses are not private or `no-store`.
- Every sitemap brand URL returns `200`, is indexable, self-canonical, and has a valid reciprocal locale set.
- After targeted enrichment, 345 approved brands expose 690 eligible brand URLs.
