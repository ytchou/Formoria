import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Governed-field integrity tests.
 *
 * Two cases:
 * (a) Non-manager access: a regular user (userPage) navigates to an edit page for a brand they
 *     do NOT own (an admin-owned brand). The dashboard layout passes through because userPage
 *     owns a separate brand (seeded for case b). The edit page's canManageDashboardBrand check:
 *       isOwnerOf(userId, adminBrandId)       → false (user is not the owner)
 *       isActingAsAdmin(userEmail)             → false (user is not in ADMIN_EMAILS)
 *     returns false → server redirect to /dashboard.
 *
 *     Key constraint: the navigating user must own at least one brand for the dashboard layout
 *     to render children rather than DashboardEmptyState. DashboardEmptyState renders at the
 *     edit URL without redirecting — only the page-level guard issues redirect(). Hence the
 *     two-brand setup: userPage owns brandId (passes the layout) but not adminBrandId (triggers
 *     the page redirect).
 *
 * (b) Allow-list integrity: owner saves via the edit form and the admin-only governed columns
 *     (mit_status, status) remain untouched in the DB after the save.
 */
test.describe('Dashboard — governed field integrity', () => {
  let supabase: AnySupabaseClient;
  // Brand A (case b): owned by regular user — also gives userPage a brand so the layout renders
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let ownerUserId: string;
  // Brand B (case a): owned by admin — regular user navigating here is blocked and redirected
  let adminBrandId: string;
  let adminBrandSlug: string;

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

    const adminUser = usersData.users.find((u) => u.email === process.env.E2E_ADMIN_EMAIL);
    if (!adminUser) throw new Error(`E2E admin user not found: ${process.env.E2E_ADMIN_EMAIL}`);
    const adminUserId = adminUser.id;

    const ts = Date.now();

    // Brand A: owned by regular user (layout anchor + case b edit target)
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
    if (brandErr || !brandData) throw new Error(`Failed to seed brand A: ${brandErr?.message}`);
    brandId = brandData.id;
    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: ownerUserId,
      brand_id: brandId,
    });
    if (boErr) throw new Error(`Failed to seed brand_owners for brand A: ${boErr.message}`);

    // Brand B: owned by admin (case a redirect target — regular user is not the owner)
    adminBrandSlug = `e2e-governed-fields-admin-${ts}`;
    const { data: adminBrandData, error: adminBrandErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Governed Fields Admin ${ts}`,
        slug: adminBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        mit_status: 'unverified',
        description: '[E2E-TEST] Admin-owned brand for redirect guard test.',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (adminBrandErr || !adminBrandData)
      throw new Error(`Failed to seed brand B: ${adminBrandErr?.message}`);
    adminBrandId = adminBrandData.id;
    const { error: adminBoErr } = await supabase.from('brand_owners').insert({
      user_id: adminUserId,
      brand_id: adminBrandId,
    });
    if (adminBoErr)
      throw new Error(`Failed to seed brand_owners for brand B: ${adminBoErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (adminBrandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', adminBrandId);
      await supabase.from('brands').delete().eq('id', adminBrandId);
    }
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
   *
   * userPage owns Brand A (so the dashboard layout renders children rather than DashboardEmptyState).
   * userPage navigates to Brand B's edit page (admin-owned — userPage is neither the owner nor admin).
   * canManageDashboardBrand(userId, userEmail, adminBrandId, adminBrandSlug) returns false
   * → server-side redirect("/dashboard").
   */
  test('non-manager navigating to edit page is redirected to /dashboard', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard/brands/${adminBrandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }
    // Server-side redirect: should land on /dashboard (not the edit page)
    await expect(userPage).toHaveURL(/\/dashboard(?:\/)?$/, { timeout: 60_000 });
    // Confirm the brand edit form is NOT present
    await expect(userPage.locator('textarea[name="description"]')).toHaveCount(0);
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
