import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Claim smoke', () => {
  let supabaseAdmin: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let userId: string;

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
        description: 'Throwaway community brand for claim smoke coverage.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
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

    await userPage.getByRole('button', { name: '認領這個品牌' }).click();
    await userPage.locator('#claim-proof-type').selectOption('domain_email');
    await userPage.locator('#claim-proof-url').fill(`https://example.com/proof/${brandSlug}`);
    await userPage
      .locator('#claim-proof-notes')
      .fill('Smoke-test claim submitted by the seeded non-owner user fixture.');
    await userPage.getByRole('button', { name: '提交認領' }).click();

    await expect(
      userPage.getByText(/我們已收到你的認領申請|your claim has been submitted/i)
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const { data, error } = await supabaseAdmin
            .from('claim_requests')
            .select('id')
            .eq('brand_id', brandId)
            .eq('user_id', userId)
            .maybeSingle<{ id: string }>();

          if (error) throw error;
          return data?.id ?? null;
        },
        { timeout: 15_000, intervals: [500, 1_000, 2_000] }
      )
      .not.toBeNull();

    await adminPage.goto('/admin/claim-requests');
    await expect(
      adminPage.getByRole('heading', { name: /claim requests/i })
    ).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText(brandName, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await adminPage.getByText(brandName, { exact: true }).click();
    const approveBtn = adminPage.getByRole('button', { name: /^approve$/i });
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await approveBtn.click();
    await expect(approveBtn).toBeHidden({ timeout: 15_000 });

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

    // Verified badge is eventually consistent: the brand detail page is ISR-cached,
    // so poll-reload until the regenerated page reflects the approved ownership.
    await expect(async () => {
      await userPage.goto(brandPath);
      await expect(
        userPage.getByTitle('由品牌方經營管理')
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] });
  });
});
