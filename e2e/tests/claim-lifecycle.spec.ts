import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

type ClaimProof = {
  type?: string;
  imageKey?: string;
  verified?: boolean;
  tokenHash?: string;
  tokenExpiresAt?: string;
};

type ClaimRow = {
  id: string;
  status: string;
  reviewer_notes: string | null;
  proof_evidence: ClaimProof[] | null;
};

type SeededBrand = {
  id: string;
  name: string;
  slug: string;
};

function serviceClient(): AnySupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function claimProofPath(storageKey: string): string {
  return storageKey.startsWith('claim-proofs/')
    ? storageKey.slice('claim-proofs/'.length)
    : storageKey;
}

function minimalPdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body);
  const xrefRows = offsets.map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `);
  return Buffer.from(
    `${body}xref\n0 5\n0000000000 65535 f \n${xrefRows.join('\n')}\n` +
      `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
}

async function seedBrand(supabase: AnySupabaseClient, suffix: string): Promise<SeededBrand> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `[E2E-TEST] Claim ${suffix} ${stamp}`;
  const slug = `e2e-claim-${suffix}-${stamp}`;
  const { data, error } = await supabase
    .from('brands')
    .insert({
      name,
      slug,
      status: 'approved',
      product_type: 'crafts',
      description: `Disposable ${suffix} claim lifecycle brand.`,
      retail_locations: [],
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) {
    throw new Error(`Failed to seed ${suffix} brand: ${error?.message ?? 'missing row'}`);
  }
  return { id: data.id, name, slug };
}

async function getClaimRow(
  supabase: AnySupabaseClient,
  brandId: string,
  userId: string,
): Promise<ClaimRow | null> {
  const { data, error } = await supabase
    .from('claim_requests')
    .select('id, status, reviewer_notes, proof_evidence')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .maybeSingle<ClaimRow>();
  if (error) throw error;
  return data;
}

async function storageObjectExists(
  supabase: AnySupabaseClient,
  storageKey: string,
): Promise<boolean> {
  const { data } = await supabase.storage
    .from('claim-proofs')
    .download(claimProofPath(storageKey));
  return data !== null;
}

async function cleanupScenario(
  supabase: AnySupabaseClient,
  brand: SeededBrand | undefined,
  userId: string,
  claimId: string | undefined,
  storageKeys: Set<string>,
): Promise<void> {
  if (!brand) return;

  if (claimId) {
    await supabase.from('claim_proof_cleanup_jobs').delete().eq('claim_request_id', claimId);
  }
  const prefix = `${userId}/${brand.id}`;
  const { data: objects } = await supabase.storage.from('claim-proofs').list(prefix);
  for (const object of objects ?? []) {
    storageKeys.add(`${prefix}/${object.name}`);
  }
  if (storageKeys.size > 0) {
    await supabase.storage
      .from('claim-proofs')
      .remove([...storageKeys].map(claimProofPath));
  }
  await supabase.from('claim_requests').delete().eq('brand_id', brand.id);
  await supabase.from('brand_owners').delete().eq('brand_id', brand.id);
  await supabase.from('brands').delete().eq('id', brand.id);
}

async function openAdminClaim(page: Page, brandName: string) {
  await page.goto('/admin/claims', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /claim requests/i })).toBeVisible({
    timeout: 60_000,
  });
  const row = page.getByRole('row').filter({ hasText: brandName }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
}

test.describe('Claim request lifecycle', () => {
  test('domain email must be verified through the real route before approval', async ({
    isolatedUserPage,
    isolatedUser,
    adminPage,
  }) => {
    test.setTimeout(180_000);
    const supabase = serviceClient();
    let brand: SeededBrand | undefined;
    let claimId: string | undefined;
    const storageKeys = new Set<string>();

    try {
      brand = await seedBrand(supabase, 'domain-email');
      const brandPath = `/brands/${brand.slug}`;
      const response = await isolatedUserPage.goto(brandPath);
      if (response?.status() === 503) {
        test.skip(true, 'PREVIEW_MODE blocks the authenticated user fixture in this env.');
        return;
      }

      await isolatedUserPage.getByRole('button', { name: '認領這個品牌' }).click();
      await isolatedUserPage.locator('#claim-proof-domain_email').check();
      await isolatedUserPage.locator('#claim-domain_email-email').fill(`owner@${brand.slug}.test`);
      const submit = isolatedUserPage.getByRole('button', { name: '送出認領申請' });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(isolatedUserPage.getByText('已收到你的認領申請')).toBeVisible();

      await expect
        .poll(async () => (await getClaimRow(supabase, brand!.id, isolatedUser.id))?.id ?? null, {
          timeout: 15_000,
          intervals: [500, 1_000, 2_000],
        })
        .not.toBeNull();
      const pendingClaim = await getClaimRow(supabase, brand.id, isolatedUser.id);
      if (!pendingClaim) throw new Error('Submitted domain-email claim was not found.');
      claimId = pendingClaim.id;

      await openAdminClaim(adminPage, brand.name);
      await expect(adminPage.getByText(/Pending verification|待驗證/)).toBeVisible();
      await expect(adminPage.getByText(/^Pending$/i)).toBeVisible();
      await adminPage.getByRole('button', { name: /^approve$/i }).click();
      await expect(
        adminPage.locator('[role="alert"]').filter({
          hasText: 'Domain email proof must be verified before approval',
        }),
      ).toBeVisible();

      const { data: ownerBeforeVerification, error: ownerBeforeVerificationError } = await supabase
        .from('brand_owners')
        .select('id')
        .eq('brand_id', brand.id)
        .maybeSingle<{ id: string }>();
      if (ownerBeforeVerificationError) throw ownerBeforeVerificationError;
      expect(ownerBeforeVerification).toBeNull();

      const proofIndex = (pendingClaim.proof_evidence ?? []).findIndex(
        (proof) => proof.type === 'domain_email',
      );
      if (proofIndex < 0) throw new Error('Domain-email proof was not persisted.');
      // No test outbox exists, so outbound delivery is excluded; the real verification route is covered below.
      const deterministicToken = `e2e-domain-token-${brand.id}`;
      const nextProofEvidence = (pendingClaim.proof_evidence ?? []).map((proof, index) =>
        index === proofIndex
          ? {
              ...proof,
              tokenHash: sha256(deterministicToken),
              tokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            }
          : proof,
      );
      const { error: tokenError } = await supabase
        .from('claim_requests')
        .update({ proof_evidence: nextProofEvidence })
        .eq('id', claimId);
      if (tokenError) throw tokenError;

      await isolatedUserPage.goto(
        `/api/claim/verify-email?cr=${encodeURIComponent(claimId)}&i=${proofIndex}` +
          `&token=${encodeURIComponent(deterministicToken)}&locale=zh-TW`,
      );
      const verificationUrl = new URL(isolatedUserPage.url());
      expect(verificationUrl.pathname).toMatch(
        new RegExp(`^/(?:zh-TW/)?brands/${brand.slug}$`),
      );
      expect(verificationUrl.searchParams.get('claim')).toBe('verified');
      await expect
        .poll(async () => {
          const verifiedClaim = await getClaimRow(supabase, brand!.id, isolatedUser.id);
          return verifiedClaim?.proof_evidence?.find((proof) => proof.type === 'domain_email')
            ?.verified ?? false;
        })
        .toBe(true);

      await adminPage.reload();
      await openAdminClaim(adminPage, brand.name);
      await expect(adminPage.getByText(/Verified|已驗證/)).toBeVisible();
      await adminPage.getByRole('button', { name: /^approve$/i }).click();
      await adminPage.getByRole('tab', { name: /^Approved \(/ }).click();
      const approvedRow = adminPage.getByRole('row').filter({ hasText: brand.name }).first();
      await expect(approvedRow).toBeVisible();

      await expect
        .poll(async () => {
          const { data, error } = await supabase
            .from('brand_owners')
            .select('user_id')
            .eq('brand_id', brand!.id)
            .eq('user_id', isolatedUser.id)
            .maybeSingle<{ user_id: string }>();
          if (error) throw error;
          return data?.user_id ?? null;
        })
        .toBe(isolatedUser.id);

      // The public brand page is ISR-cached; the authenticated dashboard reads
      // current ownership and exposes the owner-only edit action immediately.
      await expect(async () => {
        await isolatedUserPage.goto('/dashboard');
        await expect(isolatedUserPage).toHaveURL(
          new RegExp(`/dashboard/brands/${brand.slug}$`),
          { timeout: 5_000 },
        );
        await expect(
          isolatedUserPage.getByRole('heading', { level: 1, name: brand.name }),
        ).toBeVisible({ timeout: 5_000 });
        await expect(
          isolatedUserPage.getByRole('link', { name: '編輯品牌' }).first(),
        ).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] });
    } finally {
      await cleanupScenario(supabase, brand, isolatedUser.id, claimId, storageKeys);
    }
  });

  test('private business document can be rejected, deleted, and never grant ownership', async ({
    isolatedUserPage,
    isolatedUser,
    adminPage,
    anonPage,
  }) => {
    test.setTimeout(180_000);
    const supabase = serviceClient();
    let brand: SeededBrand | undefined;
    let claimId: string | undefined;
    const storageKeys = new Set<string>();
    const rejectionNotes = '[E2E-TEST] Document does not establish ownership.';

    try {
      brand = await seedBrand(supabase, 'business-doc');
      const response = await isolatedUserPage.goto(`/brands/${brand.slug}`);
      if (response?.status() === 503) {
        test.skip(true, 'PREVIEW_MODE blocks the authenticated user fixture in this env.');
        return;
      }

      await isolatedUserPage.getByRole('button', { name: '認領這個品牌' }).click();
      await isolatedUserPage.locator('#claim-proof-business_doc').check();
      await isolatedUserPage.locator('#claim-business_doc-image').setInputFiles({
        name: 'business-registration.pdf',
        mimeType: 'application/pdf',
        buffer: minimalPdf(),
      });
      const submit = isolatedUserPage.getByRole('button', { name: '送出認領申請' });
      await expect(submit).toBeEnabled({ timeout: 15_000 });
      await submit.click();
      await expect(isolatedUserPage.getByText('已收到你的認領申請')).toBeVisible();

      await expect
        .poll(async () => (await getClaimRow(supabase, brand!.id, isolatedUser.id))?.id ?? null, {
          timeout: 15_000,
          intervals: [500, 1_000, 2_000],
        })
        .not.toBeNull();
      const pendingClaim = await getClaimRow(supabase, brand.id, isolatedUser.id);
      if (!pendingClaim) throw new Error('Submitted business-document claim was not found.');
      claimId = pendingClaim.id;
      const businessProof = (pendingClaim.proof_evidence ?? []).find(
        (proof) => proof.type === 'business_doc',
      );
      if (!businessProof?.imageKey) throw new Error('Business-document storage key was not persisted.');
      const businessStorageKey = businessProof.imageKey;
      storageKeys.add(businessStorageKey);

      const publicObjectUrl =
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/claim-proofs/` +
        claimProofPath(businessStorageKey)
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');
      const publicResponse = await anonPage.goto(publicObjectUrl);
      expect(publicResponse?.status()).not.toBe(200);

      await openAdminClaim(adminPage, brand.name);
      await adminPage.getByRole('button', { name: /^reject$/i }).click();
      await adminPage
        .getByPlaceholder('Why are you rejecting this claim?')
        .fill(rejectionNotes);
      await adminPage.getByRole('button', { name: /confirm reject/i }).click();

      await adminPage.getByRole('tab', { name: /^Rejected \(/ }).click();
      const rejectedRow = adminPage.getByRole('row').filter({ hasText: brand.name }).first();
      await expect(rejectedRow).toBeVisible({ timeout: 15_000 });
      await expect(rejectedRow).toHaveAttribute('aria-expanded', 'true');
      await expect(adminPage.getByText(rejectionNotes, { exact: true })).toBeVisible();
      await expect(adminPage.getByText(/Proof file cleanup|證明檔案清理狀態/)).toBeVisible();
      await expect(adminPage.getByText(/Deleted|已刪除/, { exact: true })).toBeVisible();

      await expect
        .poll(async () => {
          const { data, error } = await supabase
            .from('claim_proof_cleanup_jobs')
            .select('status')
            .eq('claim_request_id', claimId)
            .maybeSingle<{ status: string }>();
          if (error) throw error;
          return data?.status ?? null;
        })
        .toBe('completed');
      await expect.poll(() => storageObjectExists(supabase, businessStorageKey)).toBe(false);

      const rejectedClaim = await getClaimRow(supabase, brand.id, isolatedUser.id);
      expect(rejectedClaim?.status).toBe('rejected');
      expect(rejectedClaim?.reviewer_notes).toBe(rejectionNotes);
      const { data: owner, error: ownerError } = await supabase
        .from('brand_owners')
        .select('id')
        .eq('brand_id', brand.id)
        .maybeSingle<{ id: string }>();
      if (ownerError) throw ownerError;
      expect(owner).toBeNull();
    } finally {
      await cleanupScenario(supabase, brand, isolatedUser.id, claimId, storageKeys);
    }
  });
});
