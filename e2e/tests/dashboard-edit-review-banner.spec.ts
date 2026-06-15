import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Dashboard EditReviewBanner', () => {
  let supabase: AnySupabaseClient;
  let testUserId: string;

  // One brand per journey to avoid unique-pending-per-brand constraint
  let pendingBrandId: string;
  let pendingBrandSlug: string;
  let rejectedBrandId: string;
  let rejectedBrandSlug: string;
  let approvedBrandId: string;
  let approvedBrandSlug: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);
    testUserId = testUser.id;

    const ts = Date.now();

    async function seedBrand(label: string, slug: string) {
      const { data, error } = await supabase
        .from('brands')
        .insert({
          name: `[E2E-TEST] ${label} ${ts}`,
          slug,
          status: 'approved',
          description: `[E2E-TEST] ${label} initial description`,
          purchase_links: [],
          social_links: {},
          retail_locations: [],
          product_photos: [],
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`seed brand ${label}: ${error?.message}`);
      await supabase.from('brand_owners').insert({ user_id: testUserId, brand_id: data.id });
      return data.id as string;
    }

    pendingBrandSlug = `e2e-banner-pending-${ts}`;
    rejectedBrandSlug = `e2e-banner-rejected-${ts}`;
    approvedBrandSlug = `e2e-banner-approved-${ts}`;

    [pendingBrandId, rejectedBrandId, approvedBrandId] = await Promise.all([
      seedBrand('EditBanner Pending', pendingBrandSlug),
      seedBrand('EditBanner Rejected', rejectedBrandSlug),
      seedBrand('EditBanner Approved', approvedBrandSlug),
    ]);

    const now = new Date().toISOString();

    // Seed a pending edit for Journey 3
    const { error: pendingEditErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: pendingBrandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed pending description' },
      status: 'pending',
    });
    if (pendingEditErr) throw new Error(`seed pending edit: ${pendingEditErr.message}`);

    // Seed a rejected edit for Journey 4
    const { error: rejectedEditErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: rejectedBrandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed rejected description' },
      status: 'rejected',
      reviewer_notes: 'Test rejection reason for banner',
      reviewed_at: now,
    });
    if (rejectedEditErr) throw new Error(`seed rejected edit: ${rejectedEditErr.message}`);

    // Seed an approved edit for Journey 5
    const { error: approvedEditErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: approvedBrandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed approved description' },
      status: 'approved',
      reviewed_at: now,
    });
    if (approvedEditErr) throw new Error(`seed approved edit: ${approvedEditErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [pendingBrandId, rejectedBrandId, approvedBrandId].filter(Boolean);
    if (ids.length) {
      await supabase.from('pending_brand_edits').delete().in('brand_id', ids);
      await supabase.from('brand_owners').delete().in('brand_id', ids);
      await supabase.from('brands').delete().in('id', ids);
    }
  });

  test('pending edit shows amber banner with 待審核 state', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard?tab=${pendingBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('heading', { name: '經營者主控台' })).toBeVisible({ timeout: 60_000 });

    // EditReviewBanner for pending: amber bg, pendingMessage text, 審核中 badge
    await expect(userPage.getByText('您的編輯正在審核中')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('審核中', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('rejected edit shows rejection banner with notes and resubmit link', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard?tab=${rejectedBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('heading', { name: '經營者主控台' })).toBeVisible({ timeout: 60_000 });

    // EditReviewBanner for rejected: shows rejection label and reviewer notes
    await expect(userPage.getByText('編輯需要修改')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('Test rejection reason for banner')).toBeVisible({ timeout: 5_000 });

    // Resubmit link navigates to /dashboard/brands/[slug]/edit
    const resubmitLink = userPage.getByRole('link', { name: '重新編輯' });
    await expect(resubmitLink).toBeVisible({ timeout: 5_000 });
    await resubmitLink.click();
    await expect(userPage).toHaveURL(new RegExp(`/dashboard/brands/${rejectedBrandSlug}/edit`), { timeout: 60_000 });
  });

  test('approved edit shows green banner and can be dismissed', async ({ userPage }) => {
    test.setTimeout(120_000);

    const resp = await userPage.goto(`/dashboard?tab=${approvedBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('heading', { name: '經營者主控台' })).toBeVisible({ timeout: 60_000 });

    // EditReviewBanner for approved: shows approved label
    await expect(userPage.getByText('編輯已通過並上線')).toBeVisible({ timeout: 10_000 });

    // Dismiss button (aria-label="關閉") dismisses the banner
    const dismissBtn = userPage.getByRole('button', { name: '關閉' });
    await expect(dismissBtn).toBeVisible({ timeout: 5_000 });
    await dismissBtn.click();

    // Banner disappears (local state — no DB write)
    await expect(userPage.getByText('編輯已通過並上線')).toBeHidden({ timeout: 5_000 });
  });
});
