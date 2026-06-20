import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSignedAdminModeCookie } from '../helpers/admin-mode-cookie';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Governed-field integrity tests.
 *
 * Two cases:
 * (a) Non-manager access: adminPage's user is NOT in brand_owners for the seeded brand →
 *     navigating to /dashboard/brands/[slug]/edit redirects to /dashboard (server-side guard).
 *     The edit gate is `canManageBrand = isOwnerOf || isActingAsAdmin`. A god-mode admin
 *     (the default) would reach the edit page, so this test forces `fm_mode=viewer` on the
 *     admin context to downgrade `isActingAsAdmin` to false, exercising the non-manager
 *     redirect path. The `您沒有權限編輯此品牌` error is only returned from the Server Action —
 *     it's unreachable via the UI without management rights; the page guard redirects first.
 *
 * (b) Allow-list integrity: owner saves via the edit form and the admin-only governed columns
 *     (mit_status, status) remain untouched in the DB after the save.
 */
test.describe('Dashboard — governed field integrity', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let ownerUserId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);
    ownerUserId = testUser.id;

    const ts = Date.now();
    brandName = `[E2E-TEST] Governed Fields ${ts}`;
    brandSlug = `e2e-governed-fields-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        mit_status: 'unverified',
        description: '[E2E-TEST] Initial description.',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    // Link owner so the edit-form test (case b) can proceed
    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: ownerUserId,
      brand_id: brandId,
    });
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (brandId) {
      // Only the owner-save test creates a pending edit for this brand; the non-manager
      // redirect test never submits, so no per-test brand split is needed here.
      await supabase.from('moderation_flags').delete().eq('brand_id', brandId);
      await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  /**
   * Case (a): Non-manager is blocked at the page level.
   * adminPage is authenticated as the admin user (NOT in brand_owners for this brand).
   * The fm_mode=viewer cookie downgrades isActingAsAdmin → false so canManageBrand
   * falls back to ownership-only, triggering the server-side redirect.
   */
  test('non-manager navigating to edit page is redirected to /dashboard', async ({ adminPage }) => {
    test.setTimeout(120_000);

    // Downgrade the admin context to viewer mode so isActingAsAdmin = false.
    // Without this, a god-mode admin would reach the edit page via canManageBrand.
    await adminPage.context().addCookies([
      {
        name: 'fm_mode',
        value: await getSignedAdminModeCookie('viewer'),
        url: 'http://localhost:3000',
      },
    ]);

    const resp = await adminPage.goto(`/dashboard/brands/${brandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }
    // Server-side redirect: should land on /dashboard (not the edit page)
    await expect(adminPage).toHaveURL(/\/dashboard(?:\/)?$/, { timeout: 60_000 });
    // Confirm the brand edit form is NOT present
    await expect(adminPage.locator('textarea[name="description"]')).toHaveCount(0);
  });

  /**
   * Case (b): Owner saves description; governed columns (mit_status, status) are unchanged.
   */
  test('owner save does not mutate governed columns (mit_status, status)', async ({ userPage }) => {
    test.setTimeout(120_000);

    const editPath = `/dashboard/brands/${brandSlug}/edit`;
    const editResp = await userPage.goto(editPath, { timeout: 60_000 });
    if (editResp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(userPage.getByRole('heading', { name: /edit|編輯/i })).toBeVisible({ timeout: 60_000 });

    // Change the description (an owner-editable field)
    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: 5_000 });
    const updatedDescription = `[E2E-TEST] Updated via owner edit ${Date.now()}`;
    await descField.fill('');
    await descField.fill(updatedDescription);

    // Save
    await userPage.getByRole('button', { name: '儲存變更' }).click();
    await expect(userPage.getByText(/submitted for review|提交審核|審核中/i)).toBeVisible({ timeout: 15_000 });

    const { data: pendingEdit } = await supabase
      .from('pending_brand_edits')
      .select('proposed_data')
      .eq('brand_id', brandId)
      .eq('status', 'pending')
      .single();

    expect((pendingEdit?.proposed_data as Record<string, unknown>)?.description).toBe(updatedDescription);

    // Verify via service-role DB read that governed columns were not mutated
    const { data: row, error } = await supabase
      .from('brands')
      .select('mit_status, status')
      .eq('id', brandId)
      .single();

    expect(error).toBeNull();
    // Governed columns are unchanged
    expect(row?.mit_status).toBe('unverified');
    expect(row?.status).toBe('approved');
  });
});
