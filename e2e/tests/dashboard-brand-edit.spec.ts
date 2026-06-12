import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Dashboard brand edit', () => {
  let brandId: string;
  let brandSlug: string;
  let supabase: AnySupabaseClient;

  const descriptionSuffix = Date.now();
  const initialDescription = `[E2E-TEST] Initial description for edit test ${descriptionSuffix}`;
  const updatedDescription = `[E2E-TEST] Updated description after save ${descriptionSuffix}`;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Look up the test user's ID
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

    // Insert the test brand
    brandSlug = `e2e-edit-test-${Date.now()}`;
    const { data: brandData, error: brandError } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Brand Edit ${Date.now()}`,
        slug: brandSlug,
        status: 'approved',
        description: initialDescription,
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();

    if (brandError || !brandData) {
      throw new Error(`Failed to seed brand: ${brandError?.message}`);
    }
    brandId = brandData.id;

    // Link the test user as owner via brand_owners table
    const { error: ownerError } = await supabase.from('brand_owners').insert({
      user_id: testUser.id,
      brand_id: brandId,
    });

    if (ownerError) {
      throw new Error(`Failed to seed brand_owners: ${ownerError.message}`);
    }
  });

  test.afterAll(async () => {
    if (brandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('owner can edit description and change persists', async ({ userPage }) => {
    // Navigate to the edit page
    await userPage.goto(`/dashboard/brands/${brandSlug}/edit`);

    // Confirm the edit form is loaded
    await expect(
      userPage.getByRole('heading', { name: /edit/i })
    ).toBeVisible({ timeout: 10_000 });

    // Wait for the seeded value to be hydrated, then clear and fill
    const descriptionField = userPage.locator('textarea[name="description"]');
    await expect(descriptionField).toBeVisible({ timeout: 5_000 });
    await expect(descriptionField).toHaveValue(initialDescription, { timeout: 5_000 });
    await descriptionField.fill('');
    await descriptionField.fill(updatedDescription);

    // Submit the form
    await userPage.getByRole('button', { name: '儲存變更' }).click();

    // Non-admin owner edit now goes to review queue — expect confirmation, no redirect
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i)
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit/);
  });

  test('owner can edit brand highlights and change persists', async ({ userPage }) => {
    const highlight = `[E2E-TEST] 亮點 ${Date.now()}`;

    await userPage.goto(`/dashboard/brands/${brandSlug}/edit`);

    const field = userPage.locator('textarea[name="brandHighlights"]');
    await expect(field).toBeVisible({ timeout: 10_000 });
    await field.fill(highlight);

    await userPage.getByRole('button', { name: '儲存變更' }).click();

    // Non-admin owner edit now goes to review queue — expect confirmation, no redirect
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i)
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit/);
  });
});
