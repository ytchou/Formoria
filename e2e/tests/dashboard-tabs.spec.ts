import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// All journeys share the single E2E owner account. The product invariant allows
// one brand per account, so this file must seed and clean ownership serially.
test.describe.configure({ mode: 'serial' });

/**
 * Dashboard tab navigation tests.
 *
 * Journey 1: Single-brand owner dashboard landing
 *   - Default landing shows a brand panel (Edit CTA + active Profile tab)
 *   - Header shows the owned brand directly with no selector
 *   - Navigation shows My Brand instead of Submit a Brand
 *   - Active tab is determined by URL pathname, not a query param value
 *
 * Journey 2: Legacy query and route compatibility
 *   - A stale ?brand=<slug> cannot switch away from the account's single brand
 *   - /dashboard/brands/<slug> → 302 → /dashboard?brand=<slug>
 */
test.describe('Dashboard — tab navigation', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;

  test.beforeAll(async ({}, workerInfo) => {
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

    const ts = Date.now();
    const wi = workerInfo.workerIndex;
    brandName = `[E2E-TEST] Tab Nav ${ts}`;
    brandSlug = `e2e-tab-nav-${ts}-${wi}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Tab navigation test brand.',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: testUser.id,
      brand_id: brandId,
    });
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (brandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('default dashboard landing shows the single brand with owner actions', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto('/dashboard', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(userPage.getByRole('heading', { level: 1, name: brandName }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(userPage.getByRole('link', { name: '提交其他品牌' })).toBeVisible();
    const mainNav = userPage.locator('header').first();
    await expect(mainNav.getByRole('link', { name: '我的品牌' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: '提交品牌' })).toHaveCount(0);

    // Profile tab ('總覽') is the active tab when pathname === '/dashboard'
    const profileTab = userPage.locator('a').filter({ hasText: '總覽' });
    await expect(profileTab).toHaveClass(/border-primary/, { timeout: 60_000 });

  });

  test('a stale brand query cannot switch away from the account owner brand', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto('/dashboard?brand=totally-bogus-brand-that-does-not-exist', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(userPage.getByRole('heading', { level: 1, name: brandName }).first()).toBeVisible({ timeout: 60_000 });

    // Profile tab is active (pathname === '/dashboard', isActive = true)
    const profileTab = userPage.locator('a').filter({ hasText: '總覽' });
    await expect(profileTab).toHaveClass(/border-primary/, { timeout: 5_000 });
  });

});

test.describe('Dashboard — legacy brand route redirect', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;

  test.beforeAll(async ({}, workerInfo) => {
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

    const ts = Date.now();
    const wi = workerInfo.workerIndex;
    brandName = `[E2E-TEST] Legacy Redirect ${ts}`;
    brandSlug = `e2e-legacy-redirect-${ts}-${wi}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Legacy redirect test brand.',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: testUser.id,
      brand_id: brandId,
    });
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (brandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('navigating to /dashboard/brands/<slug> renders the brand overview directly', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Page renders directly at the path-based URL (no redirect)
    await expect(
      userPage.locator('[data-testid="brand-profile"]')
    ).toBeVisible({ timeout: 60_000 });
  });
});
