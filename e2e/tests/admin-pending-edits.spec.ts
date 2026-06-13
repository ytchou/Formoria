import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin pending-edits review queue', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim());
    test.skip(
      !adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env',
    );
  });

  let supabase: AnySupabaseClient;

  // Shared across both tests in this suite
  let approveBrandId: string;
  let approveBrandSlug: string;
  let rejectBrandId: string;
  let rejectBrandSlug: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);

    const ts = Date.now();

    // Brand for approve test
    approveBrandSlug = `e2e-pending-edit-approve-${ts}`;
    const { data: approveData, error: approveErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Pending Edit Approve ${ts}`,
        slug: approveBrandSlug,
        status: 'approved',
        description: '[E2E-TEST] Original description approve',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (approveErr || !approveData) throw new Error(`seed approve brand: ${approveErr?.message}`);
    approveBrandId = approveData.id;

    await supabase.from('brand_owners').insert({ user_id: testUser.id, brand_id: approveBrandId });

    // Brand for reject test
    rejectBrandSlug = `e2e-pending-edit-reject-${ts}`;
    const { data: rejectData, error: rejectErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Pending Edit Reject ${ts}`,
        slug: rejectBrandSlug,
        status: 'approved',
        description: '[E2E-TEST] Original description reject',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (rejectErr || !rejectData) throw new Error(`seed reject brand: ${rejectErr?.message}`);
    rejectBrandId = rejectData.id;

    await supabase.from('brand_owners').insert({ user_id: testUser.id, brand_id: rejectBrandId });
  });

  test.afterAll(async () => {
    const ids = [approveBrandId, rejectBrandId].filter(Boolean);
    if (ids.length) {
      await supabase.from('pending_brand_edits').delete().in('brand_id', ids);
      await supabase.from('brand_owners').delete().in('brand_id', ids);
      await supabase.from('brands').delete().in('id', ids);
    }
  });

  test('admin approves pending brand edit — brand page reflects updated description', async ({
    adminPage,
    userPage,
  }) => {
    test.setTimeout(120_000);

    const newDescription = `[E2E-TEST] Approved description ${Date.now()}`;

    // Step 1: Owner submits an edit via the dashboard edit form
    await userPage.goto(`/dashboard/brands/${approveBrandSlug}/edit`);
    await expect(userPage.getByRole('main')).toBeVisible({ timeout: 15_000 });

    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: 10_000 });
    await descField.fill('');
    await descField.fill(newDescription);
    await userPage.getByRole('button', { name: '儲存變更' }).click();
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i),
    ).toBeVisible({ timeout: 15_000 });

    // Step 2: Admin navigates to pending-edits queue
    await adminPage.goto('/admin/pending-edits');
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.getByRole('heading', { name: '品牌編輯審核' })).toBeVisible({ timeout: 10_000 });

    // Step 3: Pending edit row is visible
    await expect(adminPage.getByText(/\[E2E-TEST\] Pending Edit Approve/)).toBeVisible({ timeout: 10_000 });

    // Step 4: Expand the accordion
    const row = adminPage.locator('div', { has: adminPage.getByText(/\[E2E-TEST\] Pending Edit Approve/) });
    await row.getByRole('button', { name: '展開' }).click();

    // Step 5: Diff view is visible — proposed description appears in the expanded section
    await expect(adminPage.getByText(newDescription)).toBeVisible({ timeout: 5_000 });

    // Step 6: Click 核准 (approve)
    const approveBtn = adminPage.getByRole('button', { name: '核准' });
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await approveBtn.click();

    // Step 7: Edit row disappears or expand section closes after approval
    await expect(approveBtn).toBeHidden({ timeout: 15_000 });

    // Step 8: Brand page eventually shows updated description (ISR revalidation)
    const brandPath = `/zh-TW/brands/${approveBrandSlug}`;
    await expect(async () => {
      await adminPage.goto(brandPath);
      await expect(adminPage.getByText(newDescription)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] });
  });

  test('admin rejects pending brand edit with notes — edit removed from queue', async ({
    adminPage,
    userPage,
  }) => {
    test.setTimeout(60_000);

    const editDescription = `[E2E-TEST] Rejected description ${Date.now()}`;
    const rejectionReason = 'Test rejection reason';

    // Step 1: Owner submits edit for the reject brand
    await userPage.goto(`/dashboard/brands/${rejectBrandSlug}/edit`);
    await expect(userPage.getByRole('main')).toBeVisible({ timeout: 15_000 });

    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: 10_000 });
    await descField.fill('');
    await descField.fill(editDescription);
    await userPage.getByRole('button', { name: '儲存變更' }).click();
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i),
    ).toBeVisible({ timeout: 15_000 });

    // Step 2: Admin navigates to pending-edits queue
    await adminPage.goto('/admin/pending-edits');
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 15_000 });

    // Step 3: Pending edit row is visible
    await expect(adminPage.getByText(/\[E2E-TEST\] Pending Edit Reject/)).toBeVisible({ timeout: 10_000 });

    // Step 4: Expand the accordion
    const row = adminPage.locator('div', { has: adminPage.getByText(/\[E2E-TEST\] Pending Edit Reject/) });
    await row.getByRole('button', { name: '展開' }).click();

    // Step 5: Click 退回 (reject) — textarea should appear
    const rejectBtn = adminPage.getByRole('button', { name: '退回' });
    await expect(rejectBtn).toBeVisible({ timeout: 5_000 });
    await rejectBtn.click();
    await expect(adminPage.locator('textarea[placeholder="退回原因"]')).toBeVisible({ timeout: 5_000 });

    // Step 6: Type rejection notes and confirm
    await adminPage.locator('textarea[placeholder="退回原因"]').fill(rejectionReason);
    await adminPage.getByRole('button', { name: '確認退回' }).click();

    // Step 7: Edit row disappears from pending list
    await expect(adminPage.getByRole('button', { name: '確認退回' })).toBeHidden({ timeout: 15_000 });
  });
});
