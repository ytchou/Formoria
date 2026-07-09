import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnedBrand } from '../helpers/owned-brand';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// All journeys share the single E2E owner account. The product invariant allows
// one brand per account, so this file must seed and clean ownership serially.
// ensureOwnedBrand is used throughout so this file never fights with other
// test files over the brand_owners slot: it accepts whatever brand the user
// currently owns rather than creating a conflicting new one.
//
// NOTE: Slug assertions are intentionally slug-agnostic (they match any
// /dashboard/brands/<slug> URL).  Concurrent test files (e.g. dashboard-brand-
// owned-edit.spec.ts) may change the test user's brand_owners row between
// beforeAll and the actual test.  Checking a pre-captured slug would be a
// false assertion — the important invariant is that the user lands on THEIR
// brand's page, not on a specific slug.
test.describe.configure({ mode: 'serial' });

/**
 * Dashboard tab navigation tests.
 *
 * Journey 1: Single-brand owner dashboard landing
 *   - Default landing redirects to the path-based brand overview
 *   - Brand overview shows owner actions and active Profile tab
 *   - Navigation shows My Brand instead of Submit a Brand
 *   - Active tab is determined by URL pathname, not a query param value
 *
 * Journey 2: Legacy query and route compatibility
 *   - A stale ?brand=<slug> cannot switch away from the account's single brand
 *   - /dashboard/brands/<slug> renders the brand overview directly
 */
test.describe('Dashboard — tab navigation', () => {
  let supabase: AnySupabaseClient;

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

    // Ensure the user owns SOME brand so the dashboard doesn't show the empty state.
    // We don't capture the slug here because concurrent files may change ownership
    // by the time each test actually runs — the slug is read from the live URL instead.
    await ensureOwnedBrand(supabase, testUser.id);
  });

  // afterAll intentionally omitted: ensureOwnedBrand either found an existing
  // fixture brand or created one with the [E2E-TEST] prefix. Global teardown
  // (cleanupTestData) handles removal.

  test('default dashboard landing shows the single brand with owner actions', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto('/dashboard', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Dashboard redirects to /dashboard/brands/<slug> — any slug is acceptable
    // (concurrent files may have changed which brand the user owns).
    await expect(userPage).toHaveURL(
      /\/dashboard\/brands\/[^/]+$/,
      { timeout: 60_000 }
    );
    await expect(userPage.getByRole('heading', { level: 1 }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 60_000,
    });
    const mainNav = userPage.locator('header').first();
    await expect(mainNav.getByRole('link', { name: '我的品牌' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: '提交品牌' })).toHaveCount(0);

    // Profile tab ('總覽') is active on the path-based brand overview.
    const profileTab = userPage.locator('a').filter({ hasText: '總覽' });
    await expect(profileTab).toHaveClass(/border-foreground/, { timeout: 60_000 });
  });

  test('a stale brand query cannot switch away from the account owner brand', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto('/dashboard?brand=totally-bogus-brand-that-does-not-exist', { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Stale query is ignored — user lands on their actual brand, any slug
    await expect(userPage).toHaveURL(
      /\/dashboard\/brands\/[^/]+$/,
      { timeout: 60_000 }
    );
    await expect(userPage.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });

    // Profile tab is active on the canonical path-based brand overview.
    const profileTab = userPage.locator('a').filter({ hasText: '總覽' });
    await expect(profileTab).toHaveClass(/border-foreground/, { timeout: 5_000 });
  });

});

test.describe('Dashboard — legacy brand route redirect', () => {
  let supabase: AnySupabaseClient;

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

    await ensureOwnedBrand(supabase, testUser.id);
  });

  test('navigating to /dashboard/brands/<slug> renders the brand overview directly', async ({ userPage }) => {
    test.setTimeout(120_000);

    // Resolve the current brand slug by letting /dashboard redirect
    await userPage.goto('/dashboard', { timeout: 60_000 });
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/[^/]+$/, { timeout: 60_000 });
    const brandUrl = userPage.url();

    // Navigate directly to the path-based URL — verify it renders without an extra redirect
    const resp = await userPage.goto(brandUrl, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.locator('[data-testid="brand-profile"]')
    ).toBeVisible({ timeout: 60_000 });
  });
});
