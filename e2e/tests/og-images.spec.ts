/**
 * OG and twitter image routes — DEV-924
 *
 * Rationale: ImageResponse/satori routes can crash at runtime while `pnpm build`
 * passes (og-variable-font-crash 2026-06-01). The root /twitter-image also 404'd
 * for months because Next.js middleware intercepted it before it reached the route
 * handler (fixed in DEV-924 PR 2). The satori-crash class is owned by the far
 * faster `src/app/opengraph-image.test.tsx` and
 * `src/__tests__/app/og/trust/opengraph-image.test.tsx`, which decode a real
 * 1200x630 PNG. What only HTTP can prove is the middleware-interception class.
 *
 * Why locale-prefixed routes are kept even though a root route is already here:
 * `src/proxy.ts` decides them in two UNRELATED branches, so a root 200 is no
 * evidence about `/en/*` or `/zh-TW/og/trust/*`.
 *   - Root `/opengraph-image`, `/twitter-image` — the single-segment bare-slug
 *     branch (`segments.length === 1` + `!RESERVED_ROUTES.has(slug)`). Both
 *     names are literal entries in `RESERVED_ROUTES`; drop either one and the
 *     path is rewritten/redirected as a brand slug.
 *   - `/en/opengraph-image`, `/zh-TW/og/trust/opengraph-image` — decided by
 *     `isLocalizedPublicPath` -> `PUBLIC_INTL_SEGMENTS.has(secondSegment)`,
 *     which never consults `RESERVED_ROUTES` at all. It returns false for
 *     `opengraph-image` and for `og`, so these fall to the non-intl
 *     `NextResponse.next()` arm. Any change to that arm, to
 *     `PUBLIC_INTL_SEGMENTS`, or to the locale-inference redirect above it can
 *     404 or redirect these routes while every root route stays 200.
 * Do not delete these for being "duplicates of /twitter-image" — they are not.
 *
 * Actor: anonymous (crawlers / social scrapers). No auth, no DB seed.
 * Project: deep (e2e/tests/**\/\*.spec.ts, Desktop Chrome)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

import { seedBrand, type SeededBrand } from '../helpers/seed';

/** 5 KB floor — a blank or erroring satori render would fall below this. */
const MIN_PNG_BYTES = 5_120;

async function assertPngRoute(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.status(), `${path} → status`).toBe(200);
  expect(res.headers()['content-type'], `${path} → content-type`).toContain('image/png');
  const body = await res.body();
  expect(body.length, `${path} → body size`).toBeGreaterThan(MIN_PNG_BYTES);
}

test.describe('OG / twitter image routes', () => {
  let seeded: SeededBrand;

  /**
   * The subject used to be "whatever brand `/brands` happens to render first",
   * resolved through a `.catch(() => null)` that turned any failure into a silent
   * skip of the only two brand-scoped tests in this file. Two independent flake
   * sources in one helper: the directory sorts randomly, so a different brand was
   * exercised every run and a render that crashes on one brand's data passes on
   * the next; and the two tests below could report green while asserting nothing
   * at all (DEV-1414).
   *
   * A seeded brand fixes both. It is the same fixture every run, and it fails
   * here rather than skipping there.
   */
  test.beforeAll(async () => {
    seeded = await seedBrand({
      name: 'og-image',
      workerIndex: test.info().workerIndex,
      withLinks: true,
    });
  });

  test.afterAll(async () => {
    await seeded?.cleanup();
  });

  test('/twitter-image returns 200 PNG > 5 KB', async ({ request }) => {
    // Pinned: middleware previously intercepted /twitter-image, returning 404
    // instead of reaching the Next.js image route handler (DEV-924 PR 2).
    await assertPngRoute(request, '/twitter-image');
  });

  // --- Locale-prefixed routes (the isLocalizedPublicPath branch) ---

  test('/en/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/en/opengraph-image');
  });

  test('/zh-TW/og/trust/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/zh-TW/og/trust/opengraph-image');
  });

  // --- Brand detail routes ---

  test('/brands/<slug>/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, `/brands/${seeded.slug}/opengraph-image`);
  });
});
