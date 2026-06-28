import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Dashboard — customer voices editing', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let testUserId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);

    const testUser = usersData.users.find(
      (u) => u.email === process.env.E2E_USER_EMAIL
    );
    if (!testUser) {
      throw new Error(
        `E2E test user not found: ${process.env.E2E_USER_EMAIL}. Run global-setup first.`
      );
    }
    testUserId = testUser.id;

    const ts = Date.now();
    brandSlug = `e2e-cv-edit-${ts}`;

    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Customer Voices Edit ${ts}`,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'Brand for customer voices edit e2e',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Failed to seed brand: ${error?.message}`);
    brandId = data.id as string;

    const { error: ownerError } = await supabase.from('brand_owners').insert({
      user_id: testUserId,
      brand_id: brandId,
    });
    if (ownerError) throw new Error(`Failed to seed brand_owners: ${ownerError.message}`);
  });

  test.afterAll(async () => {
    if (brandId) {
      await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('owner can add customer voices and submit for review', async ({ userPage }) => {
    test.skip(!!process.env.PREVIEW_MODE, 'Skipped in preview mode — auth fixture may not work');
    test.setTimeout(120_000);

    await userPage.goto(`/dashboard/brands/${brandSlug}/edit`, { timeout: 60_000 });
    await expect(
      userPage.getByRole('heading', { name: /edit/i })
    ).toBeVisible({ timeout: 60_000 });

    const addButton = userPage.getByRole('button', { name: '新增顧客心聲' });
    await expect(addButton).toBeVisible({ timeout: 15_000 });

    // Add first customer voice
    await addButton.click();
    const author0 = userPage.locator('input[name="customerVoices[0].author"]');
    await expect(author0).toBeVisible({ timeout: 5_000 });
    await author0.fill('Test Customer');
    await userPage.locator('input[name="customerVoices[0].content"]').fill('Excellent product');
    await userPage.locator('input[name="customerVoices[0].source"]').fill('Instagram');

    // Add second customer voice
    await addButton.click();
    const author1 = userPage.locator('input[name="customerVoices[1].author"]');
    await expect(author1).toBeVisible({ timeout: 5_000 });
    await author1.fill('Another Fan');
    await userPage.locator('input[name="customerVoices[1].content"]').fill('Love this brand');

    // Submit the form
    await userPage.getByRole('button', { name: '儲存變更' }).click();

    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i)
    ).toBeVisible({ timeout: 15_000 });
  });
});
