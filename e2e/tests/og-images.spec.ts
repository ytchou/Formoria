/**
 * OG and twitter image routes — DEV-924
 *
 * Rationale: ImageResponse/satori routes can crash at runtime while `pnpm build`
 * passes (og-variable-font-crash 2026-06-01). The root /twitter-image also 404'd
 * for months because Next.js middleware intercepted it before it reached the route
 * handler (fixed in DEV-924 PR 2). This spec pins both failure classes by asserting
 * HTTP 200, image/png content-type, and a meaningful body size for every OG /
 * twitter image route in the app.
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

  // --- Root routes ---

  test('/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/opengraph-image');
  });

  test('/twitter-image returns 200 PNG > 5 KB', async ({ request }) => {
    // Pinned: middleware previously intercepted /twitter-image, returning 404
    // instead of reaching the Next.js image route handler (DEV-924 PR 2).
    await assertPngRoute(request, '/twitter-image');
  });

  test('English homepage social images return meaningful PNGs', async ({ request }) => {
    for (const path of ['/en/opengraph-image', '/en/twitter-image']) {
      await assertPngRoute(request, path);
    }
  });

  // --- Brand detail routes ---

  test('/brands/<slug>/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, `/brands/${seeded.slug}/opengraph-image`);
  });

  test('/brands/<slug>/twitter-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, `/brands/${seeded.slug}/twitter-image`);
  });

  // --- Locale trust OG routes ---

  test('/zh-TW/og/trust/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/zh-TW/og/trust/opengraph-image');
  });

  test('/en/og/trust/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/en/og/trust/opengraph-image');
  });
});
