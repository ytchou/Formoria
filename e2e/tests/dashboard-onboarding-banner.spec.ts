import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Dashboard onboarding UX tests (DEV-793).
 *
 * Journey 1: Newly claimed owner sees WelcomeBanner
 *   - Banner heading and CTA link visible on /dashboard?brand=<slug>
 *   - CTA href points to /dashboard/brands/<slug>/edit#media
 *
 * Journey 2: Owner dismisses WelcomeBanner
 *   - Clicking the dismiss button hides the banner (useState, no localStorage)
 *
 * Journey 3: BrandHealthCard shows score breakdown dimensions and profile drill-down
 *   - At least one health-dimension row visible; single edit-profile link present
 */
test.describe('Dashboard — onboarding banner and health card', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;

  test.beforeAll(async ({ request }, workerInfo) => {
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

    const ts = Date.now();
    const wi = workerInfo.workerIndex;
    brandName = `[E2E-TEST] Onboarding Banner ${ts}`;
    brandSlug = `e2e-onboarding-banner-${ts}-${wi}`;

    // Seed a brand with intentionally incomplete profile so completionFraction < 1.
    // No heroImageUrl, foundingYear — tier1 + tier2 items will render.
    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Onboarding banner test brand.',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    // Insert brand_owners with claimed_at = NOW() so the 7-day window is active
    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: testUser.id,
      brand_id: brandId,
      claimed_at: new Date().toISOString(),
    });
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase || !brandId) return;
    await supabase.from('brand_owners').delete().eq('brand_id', brandId);
    await supabase.from('brands').delete().eq('id', brandId);
  });

  test('Journey 1 — newly claimed owner sees WelcomeBanner with correct heading and CTA', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — onboarding tests skipped');
      return;
    }

    // Wait for the dashboard to load with the selected brand
    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('brand') === brandSlug,
      { timeout: 60_000 }
    );

    // WelcomeBanner redesigned (PR #221) → checklist-style card.
    // Heading: dashboard.onboarding.card.title = "檢視你的品牌資料" (h2)
    await expect(
      userPage.getByRole('heading', { name: '檢視你的品牌資料' })
    ).toBeVisible({ timeout: 60_000 });

    // View-all CTA link: dashboard.onboarding.card.viewAll = "查看檢查清單"
    // href points to /dashboard/onboarding?brand=<slug>
    const ctaLink = userPage.getByRole('link', { name: '查看檢查清單' });
    await expect(ctaLink).toBeVisible({ timeout: 5_000 });
    const href = await ctaLink.getAttribute('href');
    expect(href).toContain(`/dashboard/onboarding`);
  });

  test('Journey 2 — owner dismisses WelcomeBanner and it disappears', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — onboarding tests skipped');
      return;
    }

    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('brand') === brandSlug,
      { timeout: 60_000 }
    );

    // WelcomeBanner redesigned (PR #221): dismiss button removed.
    // Journey now verifies the checklist card is visible and the view-all link
    // navigates to the onboarding checklist page.
    await expect(
      userPage.getByRole('heading', { name: '檢視你的品牌資料' })
    ).toBeVisible({ timeout: 60_000 });

    // Progress bar is present
    await expect(
      userPage.getByRole('progressbar', { name: '新手任務進度' })
    ).toBeVisible({ timeout: 5_000 });

    // Navigate via the view-all link → onboarding checklist page
    const ctaLink = userPage.getByRole('link', { name: '查看檢查清單' });
    await expect(ctaLink).toBeVisible({ timeout: 5_000 });
    await ctaLink.click();
    await expect(userPage).toHaveURL(new RegExp(`/dashboard/onboarding`), { timeout: 30_000 });
  });

  test('Journey 3 — BrandHealthCard renders score breakdown dimensions and edit-profile link', async ({ userPage }) => {
    test.setTimeout(120_000);

    // BrandHealthCard now lives at the /dashboard/health sub-route (not the main dashboard page)
    const resp = await userPage.goto(`/dashboard/health?brand=${brandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — onboarding tests skipped');
      return;
    }

    // At least one dimension row in the score breakdown section
    // dashboard.health.scoreBreakdown — each row carries data-testid="health-dimension"
    const dimensionRows = userPage.locator('[data-testid="health-dimension"]');
    await expect(dimensionRows.first()).toBeVisible({ timeout: 60_000 });
    const dimCount = await dimensionRows.count();
    expect(dimCount).toBeGreaterThanOrEqual(1);

    // Profile drill-down checklist items (read-only) carry data-testid="completeness-checklist-item"
    const checklistItems = userPage.locator('[data-testid="completeness-checklist-item"]');
    await expect(checklistItems.first()).toBeVisible({ timeout: 5_000 });

    // Single edit-profile CTA at card bottom: dashboard.health.editProfile = "編輯品牌"
    // Scope to <main> to target the BrandHealthCard's link, not the layout header's link
    // (both say "編輯品牌" but the layout resolves allBrands[0] which may be a different brand
    // when parallel tests are running; the health page resolves the correct brand via searchParams).
    const editProfileLink = userPage.locator('main').getByRole('link', { name: '編輯品牌' });
    await expect(editProfileLink).toBeVisible({ timeout: 5_000 });
    const href = await editProfileLink.getAttribute('href');
    expect(href).toContain(`/dashboard/brands/${brandSlug}/edit`);
  });
});
