import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Save / unsave brand journey (DEV-776)
 *
 * Journey 1: Authenticated user saves a brand via card heart overlay
 *   - Heart button aria-label = "收藏這個品牌" → after click → "取消收藏這個品牌"
 *
 * Journey 2: Dashboard "收藏品牌" tab shows saved brand
 *   - Navigate to /dashboard?tab=saved → saved brand name visible
 *
 * Journey 3: Unsave from card → heart returns to "收藏這個品牌"
 *
 * Journey 4: Dashboard "收藏品牌" tab shows empty state after unsave
 *   - Navigating to /dashboard?tab=saved shows "還沒有收藏品牌"
 *
 * Journey 5: Unauthenticated user clicks heart → redirected to login
 */
test.describe('Brand save/unsave — card overlay', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let testUserId: string;

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
    testUserId = testUser.id;

    const ts = Date.now();
    brandName = `[E2E-TEST] Save Brand ${ts}`;
    brandSlug = `e2e-save-brand-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        description: '[E2E-TEST] Save-brand journey test brand.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (brandId) {
      // Clean up any brand_saves rows, then the brand itself
      await supabase.from('brand_saves').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('Journey 1: save brand via card heart — heart becomes filled/active', async ({ userPage }) => {
    const resp = await userPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The brand detail page renders a SaveBrandButton with inline variant
    // (brand cards on the directory use overlay; detail page uses inline).
    // Both share the same aria-label contract.
    const saveBtn = userPage.getByRole('button', { name: '收藏這個品牌' });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });

    await saveBtn.click();

    // Optimistic update: aria-label flips immediately to "取消收藏這個品牌"
    await expect(
      userPage.getByRole('button', { name: '取消收藏這個品牌' })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Journey 2: saved brand appears in dashboard "收藏品牌" tab', async ({ userPage }) => {
    // Ensure the brand is saved in DB before navigating to dashboard
    await supabase.from('brand_saves').upsert(
      { user_id: testUserId, brand_id: brandId },
      { onConflict: 'user_id,brand_id' }
    );

    const resp = await userPage.goto('/dashboard?tab=saved');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // "收藏品牌" tab link should be visible (showSavedTab = savedBrands.length > 0)
    const savedTab = userPage.locator('a[href*="tab=saved"]');
    await expect(savedTab).toBeVisible({ timeout: 10_000 });
    await expect(savedTab).toContainText('收藏品牌');

    // The saved brand's name must appear in the panel
    await expect(userPage.locator('h2').filter({ hasText: brandName })).toBeVisible({
      timeout: 10_000,
    });

    // The active tab has the terracotta bottom border
    await expect(savedTab).toHaveClass(/border-cta/);
  });

  test('Journey 3: unsave from brand page — heart returns to unfilled state', async ({ userPage }) => {
    // Ensure the brand is saved so there is something to unsave
    await supabase.from('brand_saves').upsert(
      { user_id: testUserId, brand_id: brandId },
      { onConflict: 'user_id,brand_id' }
    );

    const resp = await userPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Must render as already-saved ("取消收藏這個品牌") after hook hydrates
    const unsaveBtn = userPage.getByRole('button', { name: '取消收藏這個品牌' });
    await expect(unsaveBtn).toBeVisible({ timeout: 10_000 });

    await unsaveBtn.click();

    // Optimistic update: flips back to save state
    await expect(
      userPage.getByRole('button', { name: '收藏這個品牌' })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Journey 4: dashboard "收藏品牌" tab shows empty state when no saves', async ({ userPage }) => {
    // Ensure no brand_saves rows for this test user's seeded brand
    await supabase
      .from('brand_saves')
      .delete()
      .eq('user_id', testUserId)
      .eq('brand_id', brandId);

    // Navigate with explicit ?tab=saved — showSavedTab is true when requestedTab === 'saved'
    const resp = await userPage.goto('/dashboard?tab=saved');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Empty state heading (saveBrand.emptyTitle)
    await expect(
      userPage.getByRole('heading', { name: '還沒有收藏品牌' })
    ).toBeVisible({ timeout: 10_000 });

    // CTA to explore brands (saveBrand.exploreBrands)
    await expect(
      userPage.getByRole('link', { name: '探索品牌目錄' })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Journey 5: unauthenticated user clicking heart redirects to /auth/login', async ({ anonPage }) => {
    const resp = await anonPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    const saveBtn = anonPage.getByRole('button', { name: '收藏這個品牌' });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });

    await saveBtn.click();

    // SaveBrandButton pushes to /auth/login when no user session
    await anonPage.waitForURL((u) => u.pathname.includes('/auth/login'), {
      timeout: 10_000,
    });
  });
});

test.describe('Brand save — card overlay on directory', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ts = Date.now();
    brandName = `[E2E-TEST] Save Overlay ${ts}`;
    brandSlug = `e2e-save-overlay-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        description: '[E2E-TEST] Save-overlay journey test brand.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (brandId) {
      await supabase.from('brand_saves').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('card heart overlay: save → aria-label changes to unsave', async ({ userPage }) => {
    const resp = await userPage.goto('/brands');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Find the card for our seeded brand by its link aria-label
    const brandCard = userPage.locator(`a[aria-label="${brandName}"]`);
    await expect(brandCard).toBeVisible({ timeout: 10_000 });

    // The overlay save button is inside the card's image area
    const saveBtn = brandCard.getByRole('button', { name: '收藏這個品牌' });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });

    await saveBtn.click();

    // Optimistic: aria-label flips to unsave
    await expect(
      brandCard.getByRole('button', { name: '取消收藏這個品牌' })
    ).toBeVisible({ timeout: 5_000 });
  });
});
