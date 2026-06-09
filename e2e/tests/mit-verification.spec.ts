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
  let ownerUserId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Resolve the seeded test user's ID (needed for brand_owners row)
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);
    ownerUserId = testUser.id;

    const ts = Date.now();

    // Seed MIT-verified brand (mit_status = 'verified', no brand_owners row)
    mitBrandName = `[E2E-TEST] MIT Verified ${ts}`;
    mitBrandSlug = `e2e-mit-verified-${ts}`;
    const { data: mitData, error: mitErr } = await supabase
      .from('brands')
      .insert({
        name: mitBrandName,
        slug: mitBrandSlug,
        status: 'approved',
        description: 'E2E throwaway — MIT verified brand.',
        mit_status: 'verified',
        mit_verified_at: new Date().toISOString(),
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
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
        description: 'E2E throwaway — owner-managed brand.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (ownerErr || !ownerData) throw new Error(`Failed to seed owner brand: ${ownerErr?.message}`);
    ownerBrandId = ownerData.id;

    // Link test user as owner so isVerified = true
    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: ownerUserId,
      brand_id: ownerBrandId,
    });
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

    // MIT badge in brand-header: label = 'MIT 已驗證', title = '已通過 MIT 微笑標章登錄驗證'
    const mitBadge = anonPage.locator('span[title="已通過 MIT 微笑標章登錄驗證"]');
    await expect(mitBadge).toBeVisible({ timeout: 5_000 });
    await expect(mitBadge).toContainText('MIT 已驗證');

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

    await expect(anonPage.getByRole('heading', { level: 1, name: ownerBrandName })).toBeVisible({
      timeout: 10_000,
    });

    // Owner badge must appear
    const ownerBadge = anonPage.locator('span[title="由品牌方經營管理"]');
    await expect(ownerBadge).toBeVisible({ timeout: 5_000 });
    await expect(ownerBadge).toContainText('品牌經營');

    // MIT badge must NOT appear
    await expect(anonPage.locator('span[title="已通過 MIT 微笑標章登錄驗證"]')).toHaveCount(0);
  });
});
