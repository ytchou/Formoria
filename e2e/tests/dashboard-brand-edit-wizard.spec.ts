import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Brand edit sidebar wizard journeys (DEV-953).
 *
 * Journey 1: Default load — wizard opens at step 0 (Basic Info)
 * Journey 2: Sidebar integrity — all 9 step buttons with correct labels are visible
 * Journey 3: Save & Continue — saves draft for current section and advances to step 1 (Media)
 * Journey 4: Non-linear sidebar nav — clicking a step jumps directly to it
 * Journey 5: Deep link via ?step=N — correct section opens on initial load
 * Journey 6: Backwards compat — ?onboardingStep=basics maps to step 0
 */
test.describe('Brand edit sidebar wizard — navigation', () => {
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
    brandName = `[E2E-TEST] Wizard Nav ${ts}`;
    brandSlug = `e2e-wizard-nav-${ts}-${wi}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Sidebar wizard navigation test brand.',
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
    if (!supabase || !brandId) return;
    await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
    await supabase.from('brand_owners').delete().eq('brand_id', brandId);
    await supabase.from('brands').delete().eq('id', brandId);
  });

  test('wizard loads at step 0 (Basic Info) by default', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // Basic Info content section is visible
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 10_000 });

    // First sidebar step button is marked active
    await expect(
      userPage.locator('aside nav button').first()
    ).toHaveAttribute('data-active', 'true', { timeout: 5_000 });

    await expect(userPage.getByText('為必填欄位')).toBeVisible();
    await expect(userPage.locator('#description')).toHaveAttribute('aria-required', 'true');
    await expect(userPage.locator('#priceRange')).toHaveAttribute('aria-required', 'true');

    // Progress bar shows 1/5 = 20%
    await expect(
      userPage.getByRole('progressbar')
    ).toHaveAttribute('aria-valuenow', '20', { timeout: 5_000 });
  });

  test('sidebar shows all five step labels', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // Scope to the desktop sidebar nav (hidden on mobile, md:flex on desktop)
    const sidebarNav = userPage.locator('aside nav');

    const expectedLabels = [
      'Basic Info',
      'Media',
      'Links',
      'Locations',
      'Reputation',
    ];

    for (const label of expectedLabels) {
      await expect(
        sidebarNav.locator('button').filter({ hasText: label })
      ).toBeVisible({ timeout: 5_000 });
    }

    await expect(sidebarNav.locator('button')).toHaveCount(5);
  });

  test('Save & Continue saves draft and advances to step 1 (Media)', async ({ userPage }) => {
    test.setTimeout(90_000);

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // Basic Info is the active section before saving
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 10_000 });

    // Click Save & Continue (儲存並繼續)
    await userPage.getByRole('button', { name: '儲存並繼續' }).click();

    // URL advances to ?step=1 after the server action completes
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit\?step=1/, { timeout: 15_000 });

    // Media section is now the active content area
    await expect(userPage.locator('#media')).toBeVisible({ timeout: 10_000 });

    // Back button (上一步) appears on non-first, non-final steps
    await expect(
      userPage.getByRole('button', { name: '上一步' })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar click jumps non-linearly to Reputation (step 4)', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    const sidebarNav = userPage.locator('aside nav');
    await sidebarNav.locator('button').filter({ hasText: 'Reputation' }).click();

    await expect(userPage.locator('#reputation')).toBeVisible({ timeout: 10_000 });

    await expect(userPage).toHaveURL(/\?step=4/, { timeout: 5_000 });

    await expect(
      sidebarNav.locator('button').filter({ hasText: 'Reputation' })
    ).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('?step=3 deep link opens Locations section', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(
      `/dashboard/brands/${brandSlug}/edit?step=3`,
      { timeout: 60_000 }
    );
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // Locations section (step 4) is the active content area
    await expect(userPage.locator('#locations')).toBeVisible({ timeout: 10_000 });

    await expect(
      userPage.locator('aside nav button').nth(3)
    ).toHaveAttribute('data-active', 'true', { timeout: 5_000 });

    await expect(
      userPage.getByRole('progressbar')
    ).toHaveAttribute('aria-valuenow', '80', { timeout: 5_000 });
  });

  test('?onboardingStep=basics backwards compat loads step 0 (Basic Info)', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(
      `/dashboard/brands/${brandSlug}/edit?onboardingStep=basics`,
      { timeout: 60_000 }
    );
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // Step 0 — Basic Info — is the active content area
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 10_000 });

    // First sidebar step is active
    await expect(
      userPage.locator('aside nav button').first()
    ).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });
});
