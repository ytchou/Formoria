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
    await userPage.goto(`/dashboard/brands/${approveBrandSlug}/edit`, { timeout: 60_000 });
    await expect(userPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: 10_000 });
    await descField.fill('');
    await descField.fill(newDescription);
    await userPage.getByRole('button', { name: '儲存變更' }).click();
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i),
    ).toBeVisible({ timeout: 15_000 });

    // Step 2: Admin navigates to review-queue edits queue
    await adminPage.goto('/admin/review-queue/edits', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: '品牌編輯審核' })).toBeVisible({ timeout: 60_000 });

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
      await adminPage.goto(brandPath, { timeout: 60_000 });
      await expect(adminPage.getByText(newDescription)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] });
  });

  test('admin rejects pending brand edit with notes — edit removed from queue', async ({
    adminPage,
    userPage,
  }) => {
    test.setTimeout(120_000);

    const editDescription = `[E2E-TEST] Rejected description ${Date.now()}`;
    const rejectionReason = 'Test rejection reason';

    // Step 1: Owner submits edit for the reject brand
    await userPage.goto(`/dashboard/brands/${rejectBrandSlug}/edit`, { timeout: 60_000 });
    await expect(userPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: 10_000 });
    await descField.fill('');
    await descField.fill(editDescription);
    await userPage.getByRole('button', { name: '儲存變更' }).click();
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i),
    ).toBeVisible({ timeout: 15_000 });

    // Step 2: Admin navigates to review-queue edits queue
    await adminPage.goto('/admin/review-queue/edits', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

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

test.describe('Admin pending-edits — risk badge visibility', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim());
    test.skip(
      !adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env',
    );
  });

  let supabase: AnySupabaseClient;
  let riskBrandId: string;

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
    const brandSlug = `e2e-pending-edit-risk-${ts}`;

    // Seed brand
    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] PendingEdit Risk ${ts}`,
        slug: brandSlug,
        status: 'approved',
        description: '[E2E-TEST] Original description for risk badge test',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`seed risk brand: ${brandErr?.message}`);
    riskBrandId = brandData.id;

    await supabase.from('brand_owners').insert({ user_id: testUser.id, brand_id: riskBrandId });

    // Seed pending_brand_edit (status: 'pending')
    const { data: editData, error: editErr } = await supabase
      .from('pending_brand_edits')
      .insert({
        brand_id: riskBrandId,
        submitted_by: testUser.id,
        proposed_data: { description: '[E2E-TEST] Proposed description with phone 0912-345-678' },
        status: 'pending',
      })
      .select('id')
      .single();
    if (editErr || !editData) throw new Error(`seed pending_brand_edit: ${editErr?.message}`);

    // Seed a medium-risk moderation flag (tier2) for this brand
    const { error: flagErr } = await supabase.from('moderation_flags').insert({
      brand_id: riskBrandId,
      user_id: testUser.id,
      field_name: 'description',
      flag_reason: 'Taiwan phone number detected',
      flagged_content: '[E2E-TEST] Proposed description with phone 0912-345-678',
      tier: 'flag',
      status: 'pending',
    });
    if (flagErr) throw new Error(`seed moderation_flag: ${flagErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [riskBrandId].filter(Boolean);
    if (ids.length) {
      await supabase.from('moderation_flags').delete().in('brand_id', ids);
      await supabase.from('pending_brand_edits').delete().in('brand_id', ids);
      await supabase.from('brand_owners').delete().in('brand_id', ids);
      await supabase.from('brands').delete().in('id', ids);
    }
  });

  test('pending edit row with medium-risk moderation flag shows 中風險 badge', async ({
    adminPage,
  }) => {
    test.setTimeout(120_000);

    await adminPage.goto('/admin/review-queue/edits', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });
    await expect(adminPage.getByRole('heading', { name: '品牌編輯審核' })).toBeVisible({ timeout: 60_000 });

    // Seeded brand row is visible
    await expect(adminPage.getByText(/\[E2E-TEST\] PendingEdit Risk/)).toBeVisible({ timeout: 10_000 });

    // Medium-risk badge ("中風險") is rendered next to the pending edit row
    const row = adminPage.locator('div', { has: adminPage.getByText(/\[E2E-TEST\] PendingEdit Risk/) });
    await expect(row.getByText('中風險')).toBeVisible({ timeout: 5_000 });
  });
});
