import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { seedBrand, SeededBrand } from '../helpers/seed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Dashboard EditReviewBanner', () => {
  let supabase: AnySupabaseClient;
  let testUserId: string;

  let seeded: SeededBrand;

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
  });

  test.beforeEach(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: 'edit-banner',
      workerIndex: workerInfo.workerIndex,
      withOwner: true,
    });
  });

  test.afterEach(async () => {
    await seeded.cleanup();
  });

  test('pending edit shows amber banner with 待審核 state', async ({ userPage }) => {
    test.setTimeout(120_000);

    // Seed the pending edit for this test's brand
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: seeded.brand.id,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed pending description' },
      status: 'pending',
    });
    if (editErr) throw new Error(`seed pending edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${seeded.slug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // Verify dashboard loaded — Edit CTA always present in layout header
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });

    // EditReviewBanner for pending: amber bg, pendingMessage text, 審核中 badge
    await expect(userPage.getByText('您的編輯正在審核中')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('審核中', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('rejected edit shows rejection banner with notes and resubmit link', async ({ userPage }) => {
    test.setTimeout(120_000);

    const now = new Date().toISOString();
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: seeded.brand.id,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed rejected description' },
      status: 'rejected',
      reviewer_notes: 'Test rejection reason for banner',
      reviewed_at: now,
    });
    if (editErr) throw new Error(`seed rejected edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${seeded.slug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // Verify dashboard loaded — Edit CTA always present in layout header
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });

    // EditReviewBanner for rejected: shows rejection label and reviewer notes
    await expect(userPage.getByText('編輯需要修改')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('Test rejection reason for banner')).toBeVisible({ timeout: 5_000 });

    // Resubmit link navigates to /dashboard/brands/[slug]/edit
    const resubmitLink = userPage.getByRole('link', { name: '重新編輯' });
    await expect(resubmitLink).toBeVisible({ timeout: 5_000 });
    await resubmitLink.click();
    await expect(userPage).toHaveURL(new RegExp(`/dashboard/brands/${seeded.slug}/edit`), { timeout: 60_000 });
  });

  test('approved edit shows green banner and can be dismissed', async ({ userPage }) => {
    test.setTimeout(120_000);

    const now = new Date().toISOString();
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: seeded.brand.id,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed approved description' },
      status: 'approved',
      reviewed_at: now,
    });
    if (editErr) throw new Error(`seed approved edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${seeded.slug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // Verify dashboard loaded — Edit CTA always present in layout header
    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });

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
