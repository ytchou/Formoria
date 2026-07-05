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
  let brandSlug: string | null = null;

  test.beforeAll(async ({ browser }) => {
    // Resolve a brand slug from the live directory — no DB seed required.
    // Mirrors the slug-discovery pattern used in brand-share.spec.ts.
    const page = await browser.newPage();
    await page.goto('/brands');
    const href = await page
      .locator('main a[href^="/brands/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    await page.close();

    if (href) {
      const m = href.match(/^\/brands\/(.+)$/);
      brandSlug = m ? m[1] : null;
    }
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

  // --- Brand detail routes ---

  test('/brands/<slug>/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    if (!brandSlug) {
      test.skip(true, 'No approved brand found in /brands — skipping brand OG image test.');
      return;
    }
    await assertPngRoute(request, `/brands/${brandSlug}/opengraph-image`);
  });

  test('/brands/<slug>/twitter-image returns 200 PNG > 5 KB', async ({ request }) => {
    if (!brandSlug) {
      test.skip(true, 'No approved brand found in /brands — skipping brand twitter-image test.');
      return;
    }
    await assertPngRoute(request, `/brands/${brandSlug}/twitter-image`);
  });

  // --- Locale trust OG routes ---

  test('/zh-TW/og/trust/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/zh-TW/og/trust/opengraph-image');
  });

  test('/en/og/trust/opengraph-image returns 200 PNG > 5 KB', async ({ request }) => {
    await assertPngRoute(request, '/en/og/trust/opengraph-image');
  });
});
