import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnedBrand } from '../helpers/owned-brand';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Brand edit sidebar wizard journeys (DEV-953).
 *
 * Journey 1: Default load — wizard opens at step 0 (基本資料)
 * Journey 2: Sidebar integrity — all five step buttons with current labels are visible
 * Journey 3: Save & Continue — saves progress and advances to step 1 (品牌圖片)
 * Journey 4: Non-linear sidebar nav — clicking a step jumps directly to it
 * Journey 5: Deep link via ?step=N — correct section opens on initial load
 */
test.describe('Brand edit sidebar wizard — navigation', () => {
  test.describe.configure({ mode: 'serial' });
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let originalDraftData: unknown;

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

    const brand = await ensureOwnedBrand(supabase, testUser.id);
    brandId = brand.id;
    brandSlug = brand.slug;
    originalDraftData = brand.draftData;
  });

  test.afterAll(async () => {
    if (!supabase || !brandId) return;
    await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
    await supabase.from('brands').update({ draft_data: originalDraftData }).eq('id', brandId);
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

    await expect(
      userPage.getByRole('heading', { name: '編輯品牌資料' }),
    ).toBeVisible()
    await expect(userPage.getByText('第 1 步，共 5 步').first()).toBeVisible()

    // First sidebar step button is marked as the current step
    await expect(
      userPage.locator('aside nav button').first()
    ).toHaveAttribute('aria-current', 'step', { timeout: 5_000 });

    await expect(userPage.getByText('為必填欄位')).toBeVisible();
    await expect(userPage.locator('#description')).toHaveAttribute('aria-required', 'true');
    await expect(userPage.locator('#priceRange')).toHaveAttribute('aria-required', 'true');

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
      '基本資料',
      '品牌圖片',
      '社群與購買連結',
      '據點',
      '品牌口碑',
    ];

    for (const label of expectedLabels) {
      await expect(
        sidebarNav.locator('button').filter({ hasText: label })
      ).toBeVisible({ timeout: 5_000 });
    }

    await expect(sidebarNav.locator('button')).toHaveCount(5);
  });

  test('Save & Continue saves progress, survives reload, and advances to step 1 (Brand images)', async ({ userPage }) => {
    test.setTimeout(90_000);
    const nextName = `Reload Check ${Date.now()}`;

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

    await userPage.locator('#name').fill(nextName);
    await userPage.locator('#priceRange').click();
    await userPage.getByRole('option', { name: /中價位/ }).click();

    // Click Save & Continue (儲存並繼續)
    await userPage.getByRole('button', { name: '儲存並繼續' }).click();

    // Brand images section is now the active content area
    await expect(userPage.locator('#media')).toBeVisible({ timeout: 10_000 });

    const { data: savedBrand } = await supabase
      .from('brands')
      .select('draft_data')
      .eq('id', brandId)
      .single();
    const savedDraft = savedBrand?.draft_data as Record<string, unknown> | null;
    expect(savedDraft?.name).toBe(nextName);
    expect(savedDraft?.__wizardCompletedSteps).toEqual([0]);

    await userPage.reload();
    await expect(userPage.locator('#media')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.locator('aside nav button').first().locator('svg')).toHaveCount(1);

    await userPage.locator('aside nav button').filter({ hasText: '基本資料' }).click();
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.locator('#name')).toHaveValue(nextName);

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
    await sidebarNav.locator('button').filter({ hasText: '品牌口碑' }).click();

    await expect(userPage.locator('#reputation')).toBeVisible({ timeout: 10_000 });

    await expect(userPage).toHaveURL(/\?step=4/, { timeout: 5_000 });

    await expect(
      sidebarNav.locator('button').filter({ hasText: '品牌口碑' })
    ).toHaveAttribute('aria-current', 'step', { timeout: 5_000 });
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
    ).toHaveAttribute('aria-current', 'step', { timeout: 5_000 });
  });
});
