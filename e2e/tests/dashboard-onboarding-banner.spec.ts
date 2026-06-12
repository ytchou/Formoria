import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Dashboard onboarding UX tests (DEV-793).
 *
 * Journey 1: Newly claimed owner sees WelcomeBanner
 *   - Banner heading and CTA link visible on /dashboard?tab=<slug>
 *   - CTA href points to /dashboard/brands/<slug>/edit#media
 *
 * Journey 2: Owner dismisses WelcomeBanner
 *   - Clicking the dismiss button hides the banner (useState, no localStorage)
 *
 * Journey 3: BrandCompletenessCard shows tier1 and tier2 sections
 *   - Both tier labels visible; edit links present for incomplete items
 */
test.describe('Dashboard — onboarding banner and completeness card', () => {
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
    // No heroImageUrl, logoUrl, brandHighlights, foundingYear — tier1 + tier2 items will render.
    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        description: '[E2E-TEST] Onboarding banner test brand.',
        purchase_links: [],
        social_links: {},
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
    const resp = await userPage.goto(`/dashboard?tab=${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — onboarding tests skipped');
      return;
    }

    // Wait for the specific brand tab to be rendered
    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('tab') === brandSlug,
      { timeout: 10_000 }
    );

    // Banner heading: dashboard.onboarding.banner.title = "歡迎加入 Formoria！"
    await expect(
      userPage.getByRole('heading', { name: '歡迎加入 Formoria！' })
    ).toBeVisible({ timeout: 10_000 });

    // CTA link: dashboard.onboarding.banner.cta = "開始編輯"
    // href must point to /dashboard/brands/<slug>/edit#media
    const ctaLink = userPage.getByRole('link', { name: '開始編輯' });
    await expect(ctaLink).toBeVisible({ timeout: 5_000 });
    const href = await ctaLink.getAttribute('href');
    expect(href).toContain(`/dashboard/brands/${brandSlug}/edit`);
  });

  test('Journey 2 — owner dismisses WelcomeBanner and it disappears', async ({ userPage }) => {
    const resp = await userPage.goto(`/dashboard?tab=${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — onboarding tests skipped');
      return;
    }

    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('tab') === brandSlug,
      { timeout: 10_000 }
    );

    // Assert banner is visible before dismissal
    await expect(
      userPage.getByRole('heading', { name: '歡迎加入 Formoria！' })
    ).toBeVisible({ timeout: 10_000 });

    // Dismiss: dashboard.onboarding.banner.dismiss = "稍後再說"
    await userPage.getByRole('button', { name: '稍後再說' }).click();

    // Banner must disappear (useState-only dismiss — no localStorage involved)
    await expect(
      userPage.getByRole('heading', { name: '歡迎加入 Formoria！' })
    ).not.toBeVisible({ timeout: 5_000 });

    // Page is still loaded — brand name heading still present
    await expect(
      userPage.locator('h2').filter({ hasText: brandName })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Journey 3 — BrandCompletenessCard renders tier1 and tier2 sections with edit links', async ({ userPage }) => {
    const resp = await userPage.goto(`/dashboard?tab=${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — onboarding tests skipped');
      return;
    }

    await userPage.waitForURL(
      (u) => new URL(u).searchParams.get('tab') === brandSlug,
      { timeout: 10_000 }
    );

    // Tier 1 label: dashboard.onboarding.tier1Label = "重要項目"
    await expect(
      userPage.getByText('重要項目', { exact: true })
    ).toBeVisible({ timeout: 10_000 });

    // Tier 2 label: dashboard.onboarding.tier2Label = "加分項目"
    await expect(
      userPage.getByText('加分項目', { exact: true })
    ).toBeVisible({ timeout: 5_000 });

    // At least one edit CTA per tier: dashboard.completeness.editCta = "編輯"
    // Tier 1 items for this brand: heroImage, logo, purchaseLinks, productPhotos are incomplete
    // (description is the only complete tier1 item)
    const editLinks = userPage.locator('[data-testid="completeness-item"] a', {
      hasText: '編輯',
    });
    await expect(editLinks.first()).toBeVisible({ timeout: 5_000 });

    // Confirm multiple edit links exist (at least 2 — one from tier1, one from tier2)
    const count = await editLinks.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
