import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Brand detail — customer voices', () => {
  let supabase: AnySupabaseClient;
  let voicesBrandId: string;
  let voicesBrandSlug: string;
  let emptyBrandId: string;
  let emptyBrandSlug: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ts = Date.now();
    voicesBrandSlug = `e2e-cv-with-${ts}`;
    emptyBrandSlug = `e2e-cv-empty-${ts}`;

    const { data: vData, error: vError } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Customer Voices Display ${ts}`,
        slug: voicesBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'Brand with customer voices for e2e',
        retail_locations: [],
        product_photos: [],
        customer_voices: [
          { author: 'Alice', content: 'Great quality!', source: 'Google' },
        ],
      })
      .select('id')
      .single();

    if (vError || !vData) throw new Error(`Failed to seed voices brand: ${vError?.message}`);
    voicesBrandId = vData.id as string;

    const { data: eData, error: eError } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] No Customer Voices ${ts}`,
        slug: emptyBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'Brand without customer voices for e2e',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();

    if (eError || !eData) throw new Error(`Failed to seed empty brand: ${eError?.message}`);
    emptyBrandId = eData.id as string;
  });

  test.afterAll(async () => {
    const ids = [voicesBrandId, emptyBrandId].filter(Boolean);
    if (ids.length) {
      await supabase.from('pending_brand_edits').delete().in('brand_id', ids);
      await supabase.from('brands').delete().in('id', ids);
    }
  });

  test('顧客心聲 section renders with content when brand has customer voices', async ({ page }) => {
    test.setTimeout(90_000);

    await expect(async () => {
      await page.goto(`/brands/${voicesBrandSlug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByRole('heading', { name: '顧客心聲', level: 2 })
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });

    const blockquote = page.locator('blockquote').first();
    await expect(blockquote).toBeVisible();
    await expect(blockquote.getByText('Great quality!')).toBeVisible();
    await expect(blockquote.getByText('Alice')).toBeVisible();
    await expect(blockquote.getByText('Google')).toBeVisible();
  });

  test('顧客心聲 section is absent when brand has no customer voices', async ({ page }) => {
    test.setTimeout(90_000);

    await expect(async () => {
      await page.goto(`/brands/${emptyBrandSlug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });

    await expect(
      page.getByRole('heading', { name: '顧客心聲', level: 2 })
    ).not.toBeVisible();
  });
});
