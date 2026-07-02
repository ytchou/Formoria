import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Dashboard tab navigation tests.
 *
 * Journey 1: Owner dashboard landing and brand selection
 *   - Default landing shows a brand panel (Edit CTA + active Profile tab)
 *   - Navigating to /dashboard?brand=<slug> → that brand's h1 heading renders
 *   - Active tab is determined by URL pathname, not a query param value
 *
 * Journey 2: Deep-linking ?brand=<slug>
 *   - /dashboard?brand=<slug> → brand panel renders + Profile tab active
 *
 * Journey 3: IDOR guard
 *   - ?brand=<bogus-unowned-slug> → falls back to the default brand panel
 *
 * Journey 4: Legacy redirect
 *   - /dashboard/brands/<slug> → 302 → /dashboard?brand=<slug>
 */
test.describe('Dashboard — tab navigation', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;

  test.beforeAll(async () => {
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
    brandName = `[E2E-TEST] Tab Nav ${ts}`;
    brandSlug = `e2e-tab-nav-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Tab navigation test brand.',
        retail_locations: [],
        product_photos: [],
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

  test('default dashboard landing shows brand panel with Edit CTA and active Profile tab', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto('/dashboard', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Dashboard loads with some brand — Edit CTA always present in layout header
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 60_000,
    });

    // Profile tab ('品牌資訊') is the active tab when pathname === '/dashboard'
    const profileTab = userPage.locator('a').filter({ hasText: '品牌資訊' });
    await expect(profileTab).toHaveClass(/border-primary/, { timeout: 60_000 });

    // Navigate to the seeded brand explicitly via ?brand= param
    await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });

    // The seeded brand name renders as h1 in the page content area
    await expect(userPage.locator('h1').filter({ hasText: brandName })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('deep-linking ?brand=<slug> renders that brand panel directly', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The brand panel must be rendered — brand name in h1
    await expect(userPage.locator('h1').filter({ hasText: brandName })).toBeVisible({
      timeout: 60_000,
    });

    // Profile tab is active (pathname === '/dashboard', isActive = true)
    const profileTab = userPage.locator('a').filter({ hasText: '品牌資訊' });
    await expect(profileTab).toHaveClass(/border-primary/, { timeout: 5_000 });
  });

  test('bogus unowned brand slug falls back to default brand panel (IDOR guard)', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto('/dashboard?brand=totally-bogus-brand-that-does-not-exist', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Falls back to one of the user's OWNED brands (all owned test brands are
    // "[E2E-TEST] …"), never the bogus/foreign slug.
    await expect(
      userPage.locator('h1').filter({ hasText: '[E2E-TEST]' }).first()
    ).toBeVisible({ timeout: 60_000 });

    // The bogus slug is never rendered as a link (IDOR: no foreign brand exposed)
    await expect(
      userPage.locator('a[href*="brand=totally-bogus-brand-that-does-not-exist"]')
    ).toHaveCount(0);

    // A brand management panel rendered (Edit CTA), not an error page
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 60_000,
    });

    // No 5xx error messaging on screen
    await expect(userPage.getByText(/Internal Server Error|伺服器錯誤/i)).toHaveCount(0);
  });
});

test.describe('Dashboard — legacy brand route redirect', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;

  test.beforeAll(async () => {
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
    brandName = `[E2E-TEST] Legacy Redirect ${ts}`;
    brandSlug = `e2e-legacy-redirect-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Legacy redirect test brand.',
        retail_locations: [],
        product_photos: [],
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

  test('navigating to /dashboard/brands/<slug> redirects to /dashboard?brand=<slug> and renders panel', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Must land on /dashboard?brand=<slug> after the server-side redirect
    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('brand') === brandSlug,
      { timeout: 60_000 }
    );

    // The brand panel must be rendered at the final URL — brand name in h1
    await expect(userPage.locator('h1').filter({ hasText: brandName })).toBeVisible({
      timeout: 60_000,
    });
  });
});
