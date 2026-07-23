import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as baseTest, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnedBrand } from '../helpers/owned-brand';
import { writeAuthStorageStateForCredentials } from '../helpers/auth-session';

const test = baseTest.extend<{ userPage: Page }>({
  userPage: async ({ browser, isolatedUser }, provideFixture, testInfo) => {
    const storagePath = path.join(testInfo.outputDir, 'dashboard-tabs-owner.json');
    await writeAuthStorageStateForCredentials(
      isolatedUser.email,
      isolatedUser.password,
      storagePath,
      'dashboard-tabs-owner',
    );
    const context = await browser.newContext({ storageState: storagePath });
    const page = await context.newPage();
    try {
      await provideFixture(page);
    } finally {
      await context.close();
    }
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// Use the worker-scoped isolated owner so this file cannot race with other
// dashboard specs over the single-brand ownership slot.
test.describe.configure({ mode: 'serial' });

/**
 * Dashboard sidebar navigation tests.
 *
 * Journey 1: Single-brand owner dashboard landing
 *   - Default landing redirects to the path-based brand overview
 *   - Brand overview shows owner actions and active Overview sidebar link
 *   - Navigation shows My Brand instead of Submit a Brand
 *   - Active sidebar item is determined by URL pathname (aria-current="page")
 *
 * Journey 2: Legacy query and route compatibility
 *   - A stale ?brand=<slug> cannot switch away from the account's single brand
 *   - /dashboard/brands/<slug> renders the brand overview directly
 */
test.describe('Dashboard — sidebar navigation', () => {
  let supabase: AnySupabaseClient;

  test.beforeAll(async ({ isolatedUser }) => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await ensureOwnedBrand(supabase, isolatedUser.id);
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

    // Edit brand link is in the sidebar bottom section.
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
      timeout: 60_000,
    });

    const mainNav = userPage.locator('header').first();
    await expect(mainNav.getByRole('link', { name: '我的品牌' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: '提交品牌' })).toHaveCount(0);

    // Sidebar has 7 nav items; Overview ('總覽') is active on the path-based brand overview.
    const sidebar = userPage.locator('nav[aria-label]').first();
    await expect(sidebar.getByRole('link')).toHaveCount(7);
    const overviewLink = sidebar.getByRole('link', { name: '總覽' });
    await expect(overviewLink).toHaveAttribute('aria-current', 'page', { timeout: 60_000 });
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

    // Sidebar Overview link is active on the canonical path-based brand overview.
    const sidebar = userPage.locator('nav[aria-label]').first();
    const overviewLink = sidebar.getByRole('link', { name: '總覽' });
    await expect(overviewLink).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
  });

});

test.describe('Dashboard — legacy brand route redirect', () => {
  let supabase: AnySupabaseClient;

  test.beforeAll(async ({ isolatedUser }) => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await ensureOwnedBrand(supabase, isolatedUser.id);
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
