import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

type ClaimRow = {
  id: string;
  proof_evidence: Array<{ imageKey?: string }> | null;
};

function claimProofPath(storageKey: string): string {
  return storageKey.startsWith('claim-proofs/')
    ? storageKey.slice('claim-proofs/'.length)
    : storageKey;
}

test.describe('Claim smoke', () => {
  let supabaseAdmin: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let userId: string;
  let claimRequestId: string | undefined;
  const proofStorageKeys = new Set<string>();

  test.beforeAll(async () => {
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);

    const testUser = usersData.users.find((user) => user.email === process.env.E2E_USER_EMAIL);
    if (!testUser) {
      throw new Error(
        `E2E test user not found: ${process.env.E2E_USER_EMAIL}. Run global-setup first.`
      );
    }
    userId = testUser.id;

    const timestamp = Date.now();
    brandName = `[E2E-TEST] Claim Smoke ${timestamp}`;
    brandSlug = `e2e-claim-smoke-${timestamp}`;

    const { data: brandData, error: brandError } = await supabaseAdmin
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'Throwaway community brand for claim smoke coverage.',
        retail_locations: [],
      })
      .select('id')
      .single();

    if (brandError || !brandData) {
      throw new Error(`Failed to seed claim smoke brand: ${brandError?.message}`);
    }
    brandId = brandData.id;
  });

  test.afterAll(async () => {
    if (!supabaseAdmin || !brandId) return;

    const { data: remainingClaims } = await supabaseAdmin
      .from('claim_requests')
      .select('id')
      .eq('brand_id', brandId);
    const claimIds = new Set<string>(
      (remainingClaims ?? []).flatMap((claim: { id?: string }) => claim.id ? [claim.id] : []),
    );
    if (claimRequestId) claimIds.add(claimRequestId);
    if (claimIds.size > 0) {
      await supabaseAdmin
        .from('claim_proof_cleanup_jobs')
        .delete()
        .in('claim_request_id', [...claimIds]);
    }
    const storagePrefix = `${userId}/${brandId}`;
    const { data: remainingObjects } = await supabaseAdmin.storage
      .from('claim-proofs')
      .list(storagePrefix);
    for (const object of remainingObjects ?? []) {
      proofStorageKeys.add(`${storagePrefix}/${object.name}`);
    }
    if (proofStorageKeys.size > 0) {
      await supabaseAdmin.storage
        .from('claim-proofs')
        .remove([...proofStorageKeys].map(claimProofPath));
    }
    await supabaseAdmin.from('claim_requests').delete().eq('brand_id', brandId);
    await supabaseAdmin.from('brand_owners').delete().eq('brand_id', brandId);
    await supabaseAdmin.from('brands').delete().eq('id', brandId);
  });

  test('non-owner can claim a community brand and admin can approve it', async ({
    userPage,
    adminPage,
  }) => {
    test.setTimeout(180_000);

    const brandPath = `/brands/${brandSlug}`;
    const brandResponse = await userPage.goto(brandPath);
    if (brandResponse?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE blocks the authenticated user fixture in this env.');
      return;
    }

    await expect(userPage.getByRole('heading', { level: 1, name: brandName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(userPage.getByRole('button', { name: '認領這個品牌' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(userPage.getByTitle('由品牌方經營管理')).toHaveCount(0);

    // Open the claim form
    await userPage.getByRole('button', { name: '認領這個品牌' }).click();

    // Use upload-backed proof. Domain-email claims must be verified before approval.
    await userPage.locator('#claim-proof-backend_screenshot').check();
    await userPage.locator('#claim-backend_screenshot-image').setInputFiles({
      name: 'backend-proof.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });

    // Submit — button reads "送出認領申請" when idle
    const submitClaimButton = userPage.getByRole('button', { name: '送出認領申請' });
    await expect(submitClaimButton).toBeEnabled({ timeout: 15_000 });
    await submitClaimButton.click();

    // Success state: inline pending section (not a toast)
    await expect(userPage.getByText('已收到你的認領申請')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText(/我們會盡快審核/)).toBeVisible({ timeout: 5_000 });

    // DB: claim_request row exists with proof_evidence array of length >= 1
    await expect
      .poll(
        async () => {
          const { data, error } = await supabaseAdmin
            .from('claim_requests')
            .select('proof_evidence')
            .eq('brand_id', brandId)
            .eq('user_id', userId)
            .maybeSingle<{ proof_evidence: unknown[] | null }>();

          if (error) throw error;
          return Array.isArray(data?.proof_evidence) ? data.proof_evidence.length : 0;
        },
        { timeout: 15_000, intervals: [500, 1_000, 2_000] }
      )
      .toBeGreaterThanOrEqual(1);

    const { data: claimRow, error: claimRowError } = await supabaseAdmin
      .from('claim_requests')
      .select('id, proof_evidence')
      .eq('brand_id', brandId)
      .eq('user_id', userId)
      .single<ClaimRow>();
    if (claimRowError || !claimRow) {
      throw new Error(`Failed to load submitted claim: ${claimRowError?.message ?? 'missing row'}`);
    }
    claimRequestId = claimRow.id;
    for (const proof of claimRow.proof_evidence ?? []) {
      if (proof.imageKey) proofStorageKeys.add(proof.imageKey);
    }
    expect(proofStorageKeys.size).toBeGreaterThanOrEqual(1);

    // Admin: approve the claim
    await adminPage.goto('/admin/claims', { timeout: 60_000 });
    await expect(
      adminPage.getByRole('heading', { name: /claim requests/i })
    ).toBeVisible({ timeout: 60_000 });
    await expect(adminPage.getByText(brandName, { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await adminPage.getByText(brandName, { exact: true }).click();
    const approveBtn = adminPage.getByRole('button', { name: /^approve$/i });
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await approveBtn.click();
    await expect(approveBtn).toBeHidden({ timeout: 15_000 });

    await adminPage.getByRole('tab', { name: /^Approved \(/ }).click();
    const approvedRow = adminPage.getByRole('row').filter({ hasText: brandName }).first();
    await expect(approvedRow).toBeVisible({ timeout: 15_000 });
    await expect(approvedRow).toHaveAttribute('aria-expanded', 'true');
    await expect(adminPage.getByText(/Proof file cleanup|證明檔案清理狀態/)).toBeVisible();
    await expect(adminPage.getByText(/Deleted|已刪除/, { exact: true })).toBeVisible();

    await expect
      .poll(
        async () => {
          const { data, error } = await supabaseAdmin
            .from('claim_proof_cleanup_jobs')
            .select('status')
            .eq('claim_request_id', claimRequestId)
            .maybeSingle<{ status: string }>();
          if (error) throw error;
          return data?.status ?? null;
        },
        { timeout: 15_000, intervals: [500, 1_000, 2_000] }
      )
      .toBe('completed');

    for (const storageKey of proofStorageKeys) {
      await expect
        .poll(
          async () => {
            const { data } = await supabaseAdmin.storage
              .from('claim-proofs')
              .download(claimProofPath(storageKey));
            return data !== null;
          },
          { timeout: 15_000, intervals: [500, 1_000, 2_000] }
        )
        .toBe(false);
    }

    // DB: brand_owners row created for this user
    await expect
      .poll(
        async () => {
          const { data, error } = await supabaseAdmin
            .from('brand_owners')
            .select('user_id')
            .eq('brand_id', brandId)
            .eq('user_id', userId)
            .maybeSingle<{ user_id: string }>();

          if (error) throw error;
          return data?.user_id ?? null;
        },
        { timeout: 15_000, intervals: [500, 1_000, 2_000] }
      )
      .toBe(userId);

    // The public brand page is ISR-cached, so assert immediate owner visibility through
    // the uncached authenticated dashboard instead of waiting for the public badge.
    await expect(async () => {
      await userPage.goto('/dashboard');
      await expect(userPage).toHaveURL(
        new RegExp(`/dashboard/brands/${brandSlug}$`),
        { timeout: 5_000 },
      );
      await expect(userPage.getByRole('heading', { level: 1, name: brandName })).toBeVisible({
        timeout: 5_000,
      });
      await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] });
  });
});
