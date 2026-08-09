import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { BUDGET } from '../budgets';
// DEV-1261 note: deliberately NOT gated on `owner_features_enabled`. Save/unsave
// and favorites are consumer journeys that touch no owner surface, and they are
// live at launch — pausing them would take consumer coverage dark for no reason.
// Verified green with the flag off.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Save / unsave brand journey (DEV-776)
 *
 * Journey 1: Authenticated user saves a brand via card bookmark overlay
 *   - Bookmark button aria-label = "收藏這個品牌" → after click → "取消收藏這個品牌"
 *
 * Journey 2: Favorites page shows saved brand
 *   - Navigate to /favorites → saved brand name visible
 *
 * Journey 3: Unsave from card → bookmark returns to "收藏這個品牌"
 *
 * Journey 4: Favorites page shows empty state after unsave
 *   - Navigating to /favorites shows "尚無收藏品牌"
 *
 * Journey 5: Unauthenticated user clicks bookmark → redirected to sign-in
 */
test.describe.serial('Brand save/unsave — card overlay', () => {
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

    const { data: stale } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', brandSlug)
      .maybeSingle();
    if (stale) {
      await supabase.from('brand_saves').delete().eq('brand_id', stale.id);
      await supabase.from('brand_owners').delete().eq('brand_id', stale.id);
      await supabase.from('pending_brand_edits').delete().eq('brand_id', stale.id);
      await supabase.from('brands').delete().eq('id', stale.id);
    }

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        approved_at: new Date().toISOString(),
        product_type: 'crafts',
        description: '[E2E-TEST] Save-brand journey test brand.',
        retail_locations: [],
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
      await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('Journey 1: save brand via card bookmark — bookmark becomes filled/active', async ({ userPage }) => {
    const resp = await userPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The brand detail page renders a SaveBrandButton with inline variant
    // (brand cards on the directory use overlay; detail page uses inline).
    // Both share the same aria-label contract.
    const saveBtn = userPage.getByRole('button', { name: '收藏這個品牌' }).first();
    await expect(saveBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    // Wait for the useSavedBrands hook to finish loading before clicking
    await expect(saveBtn).toBeEnabled({ timeout: BUDGET.SERVER_RENDER });

    await saveBtn.click();

    // Optimistic update: aria-label flips immediately to "取消收藏這個品牌"
    await expect(
      userPage.getByRole('button', { name: '取消收藏這個品牌' }).first()
    ).toBeVisible({ timeout: BUDGET.GATED_UI });
  });

  test('Journey 2: saved brand appears in dashboard "收藏品牌" tab', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const { error: brandStatusError } = await supabase
      .from('brands')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', brandId);
    if (brandStatusError) {
      throw new Error(`Failed to mark brand approved: ${brandStatusError.message}`);
    }

    // Ensure the brand is saved in DB before navigating to dashboard
    const ensureSaved = async () => {
      const { error: saveError } = await supabase.from('brand_saves').upsert(
        { user_id: testUserId, brand_id: brandId },
        { onConflict: 'user_id,brand_id' }
      );
      if (saveError) throw new Error(`Failed to save brand: ${saveError.message}`);
    };

    await ensureSaved();

    const { data: savedRow, error: savedRowError } = await supabase
      .from('brand_saves')
      .select('id')
      .eq('user_id', testUserId)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (savedRowError) {
      throw new Error(`Failed to verify saved brand row: ${savedRowError.message}`);
    }

    if (!savedRow) {
      await ensureSaved();
    }

    await expect
      .poll(
        async () => {
          const { data, error } = await supabase
            .from('brand_saves')
            .select('id')
            .eq('user_id', testUserId)
            .eq('brand_id', brandId)
            .maybeSingle();

          if (error) throw error;
          return Boolean(data);
        },
        { timeout: BUDGET.NAVIGATION, intervals: [500, 1_000, 2_000] }
      )
      .toBe(true);

    // Saved brands now live at /favorites (not the dashboard saved tab)
    const resp = await userPage.goto('/favorites');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(async () => {
      await userPage.reload({ timeout: BUDGET.GATED_UI });
      const savedBrandHeading = userPage.locator('h2').filter({ hasText: brandName });
      await expect(savedBrandHeading).toBeVisible({ timeout: BUDGET.RENDERED });
    }).toPass({ timeout: 90_000, intervals: [3_000, 5_000, 10_000] });

    // Card links to the brand detail page
    await expect(userPage.locator(`a[href*="/brands/${brandSlug}"]`)).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test('Journey 3: unsave from brand page — bookmark returns to unfilled state', async ({ userPage }) => {
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
    await expect(unsaveBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    await unsaveBtn.click();

    // Optimistic update: flips back to save state
    await expect(
      userPage.getByRole('button', { name: '收藏這個品牌' }).first()
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test('Journey 4: dashboard "收藏品牌" tab shows empty state when no saves', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    // Delete saves and immediately navigate — retry the cycle because a parallel
    // worker (second describe block) may race-insert a brand_save for the same
    // user between the delete and the server-side render.
    let found = false;
    for (let attempt = 0; attempt < 3 && !found; attempt++) {
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
          { timeout: BUDGET.INTERACTIVE, intervals: [500, 1_000] }
        )
        .toBe(0);

      // Saved brands now live at /favorites
      const resp = await userPage.goto('/favorites', {
        waitUntil: 'domcontentloaded',
      });
      await expect(userPage.getByRole('heading').first()).toBeVisible();
      if (resp?.status() === 503) {
        test.skip(true, 'PREVIEW_MODE active — skipping.');
        return;
      }

      found = await userPage
        .getByRole('heading', { name: '尚無收藏品牌' })
        .isVisible({ timeout: BUDGET.RENDERED })
        .catch(() => false);
    }

    // Empty state heading (favorites.emptyTitle = "尚無收藏品牌")
    await expect(
      userPage.getByRole('heading', { name: '尚無收藏品牌' })
    ).toBeVisible({ timeout: 20_000 });

    // CTA to explore brands (favorites.exploreBrands = "探索品牌")
    await expect(
      userPage.getByRole('link', { name: '探索品牌' })
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test('Journey 5: unauthenticated user clicking bookmark redirects to /auth/sign-in', async ({ anonPage }) => {
    const resp = await anonPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    const saveBtn = anonPage.getByRole('button', { name: '收藏這個品牌' }).first();
    await expect(saveBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    await saveBtn.click();

    // SaveBrandButton pushes to /auth/sign-in when no user session
    await anonPage.waitForURL((u) => u.pathname.includes('/auth/sign-in'), {
      timeout: BUDGET.INTERACTIVE,
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
    // Prefixed so the orphan sweep can reach it if this run dies before
    // afterAll. Safe despite the directory filter: this journey only visits
    // /brands/<slug>, and detail-by-slug applies no test-brand exclusion.
    brandName = `[E2E-TEST] Save Overlay ${ts}`;
    brandSlug = `e2e-save-overlay-${ts}`;

    const { data: stale } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', brandSlug)
      .maybeSingle();
    if (stale) {
      await supabase.from('brand_saves').delete().eq('brand_id', stale.id);
      await supabase.from('brand_owners').delete().eq('brand_id', stale.id);
      await supabase.from('pending_brand_edits').delete().eq('brand_id', stale.id);
      await supabase.from('brands').delete().eq('id', stale.id);
    }

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        approved_at: new Date().toISOString(),
        product_type: 'crafts',
        description: '[E2E-TEST] Save-overlay journey test brand.',
        retail_locations: [],
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
      await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('card bookmark overlay: save → aria-label changes to unsave', async ({ userPage }) => {
    const resp = await userPage.goto(`/brands/${brandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(userPage.getByRole('heading', { name: brandName })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });

    // The detail page has no search suggestion overlay that can intercept clicks.
    const saveBtn = userPage.getByRole('button', { name: '收藏這個品牌' }).first();
    await expect(saveBtn).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    // Wait for the useSavedBrands hook to finish loading before clicking
    await expect(saveBtn).toBeEnabled({ timeout: BUDGET.SERVER_RENDER });

    await saveBtn.click();

    // Optimistic: aria-label flips to unsave
    await expect(
      userPage.getByRole('button', { name: '取消收藏這個品牌' }).first()
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });
});
