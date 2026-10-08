import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { BUDGET, POLL } from '../budgets';
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
        approved_at: new Date().toISOString(),
        category: 'home',
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
      if (error) throw new Error(`[e2e-cleanup] brand-city cleanup failed: ${error.message}`);
    }
  });

  test('brand with city=taipei shows 台北市 on the detail page', async ({ page }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    // ISR pages may serve a stale cache — poll-reload until the seeded brand's city appears
    await expect(async () => {
      await page.goto(`/brands/${brandSlug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: BUDGET.INTERACTIVE });
      // The city is one part of the brand's metadata line (DEV-1951), not a
      // badge. Match it as a standalone word, not by the line's separator, so
      // a sentence elsewhere on the page that names the city cannot satisfy
      // it.
      await expect(
        page.locator('#main-content').getByText(/(^|\s)台北市(\s|$)/),
      ).toBeVisible({ timeout: BUDGET.RENDERED });
    }).toPass(POLL.DB);
  });
});
