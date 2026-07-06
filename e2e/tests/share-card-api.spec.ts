import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Share card API — /api/share-card/[slug]
 *
 * Journey: Anonymous request confirms the API renders a real 1080×1350 PNG for
 * approved brands, serves correct headers (cache-control, content-disposition),
 * and returns 404 for non-existent or hidden brand slugs.
 *
 * Actor: anonymous — uses Playwright `request` fixture; no browser page needed.
 * Seeds: one approved brand with a CJK name (exercises NotoSansTC subset) +
 *        one hidden brand (gate case).
 * Cleanup: afterAll cascade-deletes both.
 */
test.describe('Share card API', () => {
  let supabase: AnySupabaseClient;
  let approvedBrandId: string;
  let approvedBrandSlug: string;
  let hiddenBrandId: string;
  let hiddenBrandSlug: string;

  test.beforeAll(async ({ request }, workerInfo) => {
    // PREVIEW_MODE guard — probe before seeding
    const probe = await request.get('/brands');
    if (probe.status() === 503) return;

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const ts = Date.now();
    const wi = workerInfo.workerIndex;
    approvedBrandSlug = `e2e-share-card-approved-${ts}-${wi}`;
    hiddenBrandSlug = `e2e-share-card-hidden-${ts}-${wi}`;

    // Seed approved brand with CJK name — exercises 我們上架了 headline + NotoSansTC subset
    const { data: approvedData, error: approvedErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] 台灣品牌 Share Card ${ts}`,
        slug: approvedBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] share card API approved brand',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (approvedErr || !approvedData) throw new Error(`seed approved brand: ${approvedErr?.message}`);
    approvedBrandId = approvedData.id as string;

    // Seed hidden brand (gate: must return 404)
    const { data: hiddenData, error: hiddenErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Share Card Hidden ${ts}`,
        slug: hiddenBrandSlug,
        status: 'hidden',
        product_type: 'crafts',
        description: '[E2E-TEST] share card API hidden brand',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (hiddenErr || !hiddenData) throw new Error(`seed hidden brand: ${hiddenErr?.message}`);
    hiddenBrandId = hiddenData.id as string;
  });

  test.afterAll(async () => {
    if (!supabase) return;
    // ON DELETE CASCADE handles brand_owners — single brands delete is sufficient.
    if (approvedBrandId) await supabase.from('brands').delete().eq('id', approvedBrandId);
    if (hiddenBrandId) await supabase.from('brands').delete().eq('id', hiddenBrandId);
  });

  test('GET /api/share-card/<approved-slug> returns 200 PNG with correct headers and 1080×1350 dimensions', async ({ request }) => {
    // Allow generous timeout — cold satori + NotoSansTC font compile can take >10s in dev
    test.setTimeout(60_000);
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await request.get(`/api/share-card/${approvedBrandSlug}`, { timeout: 45_000 });
    expect(resp.status()).toBe(200);

    const contentType = resp.headers()['content-type'] ?? '';
    expect(contentType).toContain('image/png');

    const cacheControl = resp.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('s-maxage=86400');

    const body = await resp.body();

    // PNG magic bytes: 89 50 4E 47
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);

    // IHDR chunk: width at bytes 16–19, height at bytes 20–23 (big-endian uint32).
    // PNG layout: sig(8) + chunk-length(4) + "IHDR"(4) + width(4) + height(4) + …
    const width =
      body[16] * 0x1000000 + body[17] * 0x10000 + body[18] * 0x100 + body[19];
    const height =
      body[20] * 0x1000000 + body[21] * 0x10000 + body[22] * 0x100 + body[23];
    expect(width).toBe(1080);
    expect(height).toBe(1350);
  });

  test('GET /api/share-card/<approved-slug>?download=1 returns content-disposition attachment with filename', async ({ request }) => {
    test.setTimeout(60_000);
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await request.get(`/api/share-card/${approvedBrandSlug}?download=1`, { timeout: 45_000 });
    expect(resp.status()).toBe(200);

    const disposition = resp.headers()['content-disposition'] ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(`formoria-${approvedBrandSlug}.png`);
  });

  test('GET /api/share-card/definitely-not-a-slug-xyz returns 404', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await request.get('/api/share-card/definitely-not-a-slug-xyz');
    expect(resp.status()).toBe(404);
  });

  test('GET /api/share-card/<hidden-slug> returns 404', async ({ request }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await request.get(`/api/share-card/${hiddenBrandSlug}`);
    expect(resp.status()).toBe(404);
  });
});
