import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Favorites page journeys (/favorites)
 *
 * Journey 1: Authenticated user with saved brands sees brand card grid
 *   - /favorites shows page header + brand count
 *   - Saved brand card (h2) visible in grid
 *
 * Journey 2: Authenticated user with no saved brands sees empty state
 *   - /favorites shows empty state heading "尚無收藏品牌"
 *   - "探索品牌" CTA links to /brands
 *
 * NOTE: The middleware currently intercepts /favorites and redirects it to
 * /brands/favorites (because 'favorites' matches the brand-slug pattern and is
 * not in RESERVED_ROUTES). Add 'favorites' to RESERVED_ROUTES in
 * src/middleware.ts to allow /favorites to resolve to the favorites page.
 * Additionally, favorites/page.tsx uses t('title') but the translation key is
 * 'heading' — update the page to use t('heading') to fix the page heading.
 */
test.describe('Favorites page', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let testUserId: string;

  test.beforeAll(async ({ request }) => {
    // PREVIEW_MODE guard — probe before seeding to avoid wasted work
    const probe = await request.get('/brands');
    if (probe.status() === 503) return;

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);

    const testUser = usersData.users.find(
      (u) => u.email === process.env.E2E_USER_EMAIL
    );
    if (!testUser) {
      throw new Error(
        `E2E test user not found: ${process.env.E2E_USER_EMAIL}. Run global-setup first.`
      );
    }
    testUserId = testUser.id;

    const ts = Date.now();
    brandName = `[E2E-TEST] Favorites ${ts}`;
    brandSlug = `e2e-favorites-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Favorites page test brand.',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;
  });

  test.afterAll(async () => {
    if (!supabase || !brandId) return;
    await supabase.from('brand_saves').delete().eq('brand_id', brandId);
    await supabase.from('brands').delete().eq('id', brandId);
  });

  test('Journey 1 — user with saved brand sees brand card on /favorites', async ({ userPage }) => {
    test.skip(!!process.env.PREVIEW_MODE, 'Skipped in preview mode — auth fixture may not work');
    test.setTimeout(120_000);

    if (!supabase || !brandId) {
      test.skip(true, 'Seed skipped (PREVIEW_MODE active in beforeAll)');
      return;
    }

    // Seed the brand_save directly so the page renders a non-empty grid
    const { error: saveErr } = await supabase
      .from('brand_saves')
      .upsert({ user_id: testUserId, brand_id: brandId }, { onConflict: 'user_id,brand_id' });
    if (saveErr) throw new Error(`Failed to seed brand_save: ${saveErr.message}`);

    const resp = await userPage.goto('/favorites', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Brand card grid visible — each card shows the brand name as an h2
    await expect(async () => {
      await userPage.reload({ timeout: 30_000 });
      await expect(
        userPage.locator('h2').filter({ hasText: brandName })
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 5_000, 10_000] });

    // The card links to the brand detail page
    const brandCard = userPage.locator(`a[href*="/brands/${brandSlug}"]`);
    await expect(brandCard).toBeVisible({ timeout: 5_000 });
  });

  test('Journey 2 — user with no saved brands sees empty state on /favorites', async ({ userPage }) => {
    test.skip(!!process.env.PREVIEW_MODE, 'Skipped in preview mode — auth fixture may not work');
    test.setTimeout(120_000);

    if (!supabase) {
      test.skip(true, 'Seed skipped (PREVIEW_MODE active in beforeAll)');
      return;
    }

    // Delete ALL saves for this user so the page renders the empty state
    await supabase.from('brand_saves').delete().eq('user_id', testUserId);

    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('brand_saves')
            .select('id')
            .eq('user_id', testUserId);
          return data?.length ?? -1;
        },
        { timeout: 10_000, intervals: [500, 1_000] }
      )
      .toBe(0);

    let found = false;
    for (let attempt = 0; attempt < 3 && !found; attempt++) {
      const resp = await userPage.goto('/favorites', {
        timeout: 60_000,
        waitUntil: 'domcontentloaded',
      });
      await expect(userPage.getByRole('heading')).toBeVisible();
      if (resp?.status() === 503) {
        test.skip(true, 'PREVIEW_MODE active — skipping.');
        return;
      }

      found = await userPage
        .getByRole('heading', { name: '尚無收藏品牌' })
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
    }

    // Empty state heading (favorites.emptyTitle = "尚無收藏品牌")
    await expect(
      userPage.getByRole('heading', { name: '尚無收藏品牌' })
    ).toBeVisible({ timeout: 20_000 });

    // "探索品牌" CTA links to /brands (favorites.exploreBrands = "探索品牌")
    const exploreCta = userPage.getByRole('link', { name: '探索品牌' });
    await expect(exploreCta).toBeVisible({ timeout: 5_000 });
    const href = await exploreCta.getAttribute('href');
    expect(href).toContain('/brands');
  });
});
