import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('MIT verification badges', () => {
  let supabase: AnySupabaseClient;
  let mitBrandId: string;
  let mitBrandSlug: string;
  let mitBrandName: string;
  let ownerBrandId: string;
  let ownerBrandSlug: string;
  let ownerBrandName: string;
  // Throwaway user — avoids touching E2E_USER_EMAIL's brand_owners slot which
  // other concurrent test files depend on (cross-file race condition).
  let throwawayOwnerId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ts = Date.now();

    // Create a throwaway user to own the owner-badge test brand.
    // Using E2E_USER_EMAIL here causes a cross-file race: other parallel files
    // also upsert brand_owners for the same user_id and overwrite each other.
    const throwawayEmail = `e2e-mit-owner-${ts}@test.local`;
    const { data: throwawayData, error: throwawayError } = await supabase.auth.admin.createUser({
      email: throwawayEmail,
      password: `MitOwner${ts}A!`,
      email_confirm: true,
    });
    if (throwawayError || !throwawayData.user) {
      throw new Error(`Failed to create throwaway owner user: ${throwawayError?.message}`);
    }
    throwawayOwnerId = throwawayData.user.id;

    // Seed MIT-verified brand (mit_status = 'verified', no brand_owners row)
    mitBrandName = `[E2E-TEST] MIT Verified ${ts}`;
    mitBrandSlug = `e2e-mit-verified-${ts}`;
    const { data: mitData, error: mitErr } = await supabase
      .from('brands')
      .insert({
        name: mitBrandName,
        slug: mitBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'E2E throwaway — MIT verified brand.',
        mit_status: 'verified',
        mit_verified_at: new Date().toISOString(),
        retail_locations: [],
      })
      .select('id')
      .single();
    if (mitErr || !mitData) throw new Error(`Failed to seed MIT brand: ${mitErr?.message}`);
    mitBrandId = mitData.id;

    // Seed owner-managed brand (no mit_status, with brand_owners row)
    ownerBrandName = `[E2E-TEST] Owner Managed ${ts}`;
    ownerBrandSlug = `e2e-owner-managed-${ts}`;
    const { data: ownerData, error: ownerErr } = await supabase
      .from('brands')
      .insert({
        name: ownerBrandName,
        slug: ownerBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'E2E throwaway — owner-managed brand.',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (ownerErr || !ownerData) throw new Error(`Failed to seed owner brand: ${ownerErr?.message}`);
    ownerBrandId = ownerData.id;

    // Link throwaway user as owner — badge is visible to anonymous users regardless of owner identity
    const { error: boErr } = await supabase.from('brand_owners').insert(
      { user_id: throwawayOwnerId, brand_id: ownerBrandId },
    );
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (ownerBrandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', ownerBrandId);
      await supabase.from('brands').delete().eq('id', ownerBrandId);
    }
    if (mitBrandId) {
      await supabase.from('brands').delete().eq('id', mitBrandId);
    }
    if (throwawayOwnerId) {
      await supabase.auth.admin.deleteUser(throwawayOwnerId);
    }
  });

  test('MIT-verified brand shows gold MIT badge on detail page', async ({ anonPage }) => {
    const resp = await anonPage.goto(`/brands/${mitBrandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(anonPage.getByRole('heading', { level: 1, name: mitBrandName })).toBeVisible({
      timeout: 10_000,
    });

    // MIT badge in brand-header: label = 'MIT 微笑認證', title = '已通過 MIT 微笑標章登錄驗證'
    const mitBadge = anonPage.locator('span[title="已通過 MIT 微笑標章登錄驗證"]').first();
    await expect(mitBadge).toBeVisible({ timeout: 5_000 });
    await expect(mitBadge).toContainText('MIT 微笑認證');

    // Owner badge (品牌經營) must NOT appear — no brand_owners row
    await expect(anonPage.locator('span[title="由品牌方經營管理"]')).toHaveCount(0);
  });

  test('owner-managed brand shows owner badge but NOT MIT badge on detail page', async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto(`/brands/${ownerBrandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Allow up to 30s: freshly seeded brand page may need ISR generation under parallel-worker load
    await expect(anonPage.getByRole('heading', { level: 1, name: ownerBrandName })).toBeVisible({
      timeout: 30_000,
    });

    // Owner badge must appear
    const ownerBadge = anonPage.locator('span[title="由品牌方經營管理"]');
    await expect(ownerBadge).toBeVisible({ timeout: 5_000 });
    await expect(ownerBadge).toContainText('品牌經營');

    // MIT badge must NOT appear
    await expect(anonPage.locator('span[title="已通過 MIT 微笑標章登錄驗證"]')).toHaveCount(0);
  });
});
