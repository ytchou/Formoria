import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Dashboard tab navigation tests.
 *
 * Journey 1: Owner dashboard tab navigation
 *   - Default tab = first owned brand's panel (brand-name h2 + Edit button visible)
 *   - Clicking "提交紀錄" tab → URL ?tab=submissions + submissions content visible
 *   - Deep-linking ?tab=<slug> → that brand's panel renders
 *   - ?tab=<bogus-unowned-slug> → falls back to the default brand panel (IDOR guard)
 *
 * Journey 2: Legacy redirect
 *   - /dashboard/brands/<slug> → 302 → /dashboard?tab=<slug>
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
        description: '[E2E-TEST] Tab navigation test brand.',
        purchase_links: [],
        social_links: {},
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

  test('default tab shows owned brand panel with brand name heading and Edit CTA', async ({ userPage }) => {
    const resp = await userPage.goto('/dashboard');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The E2E user owns several accumulated [E2E-TEST] brands, so the *default*
    // tab is not deterministically this brand. Assert this brand appears as a tab,
    // that the default view is a brand panel (Edit CTA present), then select it.
    const ownTab = userPage.locator(`a[href*="tab=${brandSlug}"]`);
    await expect(ownTab).toBeVisible({ timeout: 10_000 });

    // Default landing renders a brand management panel (not submissions)
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Selecting this brand's tab renders its panel with the active border styling
    await ownTab.click();
    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('tab') === brandSlug,
      { timeout: 10_000 }
    );
    await expect(userPage.locator('h2').filter({ hasText: brandName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(ownTab).toHaveClass(/border-cta/);
  });

  test('clicking Submissions tab shows submissions content and updates URL', async ({ userPage }) => {
    const resp = await userPage.goto('/dashboard');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The tab strip renders for owners; wait for the Submissions tab to be present
    // (do not depend on which brand is the default — the user owns several).
    const submissionsTab = userPage.locator('a[href*="tab=submissions"]');
    await expect(submissionsTab).toBeVisible({ timeout: 10_000 });

    // Click the Submissions tab (t("tabs.submissions") = "提交紀錄")
    await userPage.getByRole('link', { name: '提交紀錄' }).click();

    // URL must reflect ?tab=submissions
    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('tab') === 'submissions',
      { timeout: 10_000 }
    );

    // Submissions section heading (t("mySubmissions.heading") = "我的提交")
    await expect(userPage.getByRole('heading', { name: '我的提交' })).toBeVisible({
      timeout: 5_000,
    });

    // The submissions tab link is now active
    await expect(submissionsTab).toHaveClass(/border-cta/);
  });

  test('deep-linking ?tab=<slug> renders that brand panel directly', async ({ userPage }) => {
    const resp = await userPage.goto(`/dashboard?tab=${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The brand panel must be rendered — no redirect, no fallback
    await expect(userPage.locator('h2').filter({ hasText: brandName })).toBeVisible({
      timeout: 10_000,
    });

    // The correct tab link is active
    const activeTab = userPage.locator(`a[href*="tab=${brandSlug}"]`);
    await expect(activeTab).toHaveClass(/border-cta/);
  });

  test('bogus unowned tab slug falls back to default brand panel (IDOR guard)', async ({ userPage }) => {
    const resp = await userPage.goto('/dashboard?tab=totally-bogus-brand-that-does-not-exist');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Falls back to one of the user's OWNED brands (all owned test brands are
    // "[E2E-TEST] …"), never the bogus/foreign slug. The default brand is not
    // deterministic across many owned brands, so assert on the owned prefix.
    await expect(
      userPage.locator('h2').filter({ hasText: '[E2E-TEST]' }).first()
    ).toBeVisible({ timeout: 10_000 });

    // The bogus slug is never rendered as a tab (IDOR: no foreign brand exposed)
    await expect(
      userPage.locator('a[href*="tab=totally-bogus-brand-that-does-not-exist"]')
    ).toHaveCount(0);

    // A brand management panel rendered (Edit CTA), not an error page
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 5_000,
    });

    // No 5xx error messaging on screen
    await expect(userPage.locator('text=500')).toHaveCount(0);
    await expect(userPage.locator('text=Internal Server Error')).toHaveCount(0);
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
        description: '[E2E-TEST] Legacy redirect test brand.',
        purchase_links: [],
        social_links: {},
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

  test('navigating to /dashboard/brands/<slug> redirects to /dashboard?tab=<slug> and renders panel', async ({ userPage }) => {
    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Must land on /dashboard?tab=<slug> after the server-side redirect
    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('tab') === brandSlug,
      { timeout: 10_000 }
    );

    // The brand panel must be rendered at the final URL
    await expect(userPage.locator('h2').filter({ hasText: brandName })).toBeVisible({
      timeout: 10_000,
    });
  });
});
