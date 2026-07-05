import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Brand city badge', () => {
  test.skip(process.env.PREVIEW_MODE === 'true', 'PREVIEW_MODE active — skipping DB-write test');

  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const ts = Date.now();
    brandSlug = `e2e-city-badge-${ts}`;

    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] City Badge ${ts}`,
        slug: brandSlug,
        status: 'approved',
        category: 'lifestyle',
        city: 'taipei',
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`brand-city seed failed: ${error?.message}`);
    }
    brandId = data.id as string;
  });

  test.afterAll(async () => {
    if (brandId) {
      const { error } = await supabase.from('brands').delete().eq('id', brandId);
      if (error) console.warn('[e2e-seed] brand-city cleanup failed:', error.message);
    }
  });

  test('brand with city=taipei shows 臺北市 badge on detail page', async ({ page }) => {
    test.setTimeout(90_000);

    // ISR pages may serve a stale cache — poll-reload until the seeded brand's city badge appears
    await expect(async () => {
      await page.goto(`/brands/${brandSlug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
      // City badge: rendered as a <span> containing the next-intl translated city name
      await expect(page.getByText('臺北市')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
  });
});
