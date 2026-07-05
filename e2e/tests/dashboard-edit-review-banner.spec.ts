import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// Root cause for serial + beforeEach pattern:
// DashboardLayout calls resolveDashboardBrand with no ?brand= param (layouts don't
// receive searchParams in Next.js), so it always resolves allBrands[0] ordered by
// claimed_at ASC.  With fullyParallel:true, all three tests would run concurrently
// and each beforeEach would create a brand — all three brands exist simultaneously,
// making allBrands[0] non-deterministic.
//
// test.describe.serial forces the three tests to run on one worker sequentially.
// Each beforeEach seeds exactly ONE brand; afterEach deletes it (all FK constraints
// from brands.id use ON DELETE CASCADE so a single brands delete is sufficient).
// A pre-cleanup guard in beforeEach also removes stale [E2E-TEST] EditBanner brands
// left by aborted previous runs so allBrands[0] is always the test-owned brand.

test.describe.serial('Dashboard EditReviewBanner', () => {
  let supabase: AnySupabaseClient;
  let testUserId: string;

  // Per-test state — reset by beforeEach/afterEach
  let brandId: string;
  let brandSlug: string;

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

  test.beforeEach(async () => {
    // Pre-cleanup: remove any stale [E2E-TEST] EditBanner brands owned by the test
    // user from aborted previous runs.  All FK constraints from brands.id use
    // ON DELETE CASCADE so deleting from brands cascades everything.
    const { data: ownedRows } = await supabase
      .from('brand_owners')
      .select('brand_id')
      .eq('user_id', testUserId);
    if (ownedRows?.length) {
      const ownedIds = ownedRows.map((r: { brand_id: string }) => r.brand_id);
      const { data: stale } = await supabase
        .from('brands')
        .select('id')
        .in('id', ownedIds)
        .like('name', '[E2E-TEST] EditBanner%');
      if (stale?.length) {
        const staleIds = stale.map((b: { id: string }) => b.id);
        await supabase.from('brands').delete().in('id', staleIds);
      }
    }

    const ts = Date.now();
    brandSlug = `e2e-banner-${ts}`;

    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] EditBanner ${ts}`,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: `[E2E-TEST] initial description`,
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed brand: ${error?.message}`);
    brandId = data.id as string;

    // Use a deterministically old claimed_at so this brand is always allBrands[0]
    // (dashboard layout orders owned brands by claimed_at ASC; parallel tests seed with NOW()).
    await supabase.from('brand_owners').insert({ user_id: testUserId, brand_id: brandId, claimed_at: '1970-01-01T00:00:00.000Z' });
  });

  test.afterEach(async () => {
    if (brandId) {
      // All FK constraints from brands.id use ON DELETE CASCADE —
      // deleting the brand row cascades to pending_brand_edits, brand_owners, etc.
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('pending edit shows amber banner with 待審核 state', async ({ userPage }) => {
    test.setTimeout(120_000);

    // Seed the pending edit for this test's brand
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: brandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed pending description' },
      status: 'pending',
    });
    if (editErr) throw new Error(`seed pending edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });
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
      brand_id: brandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed rejected description' },
      status: 'rejected',
      reviewer_notes: 'Test rejection reason for banner',
      reviewed_at: now,
    });
    if (editErr) throw new Error(`seed rejected edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });
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
    await expect(userPage).toHaveURL(new RegExp(`/dashboard/brands/${brandSlug}/edit`), { timeout: 60_000 });
  });

  test('approved edit shows green banner and can be dismissed', async ({ userPage }) => {
    test.setTimeout(120_000);

    const now = new Date().toISOString();
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: brandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed approved description' },
      status: 'approved',
      reviewed_at: now,
    });
    if (editErr) throw new Error(`seed approved edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${brandSlug}`, { timeout: 60_000 });
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
