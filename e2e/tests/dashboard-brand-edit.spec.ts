import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Dashboard brand edit', () => {
  let descriptionBrandId: string;
  let descriptionBrandSlug: string;
  let highlightsBrandId: string;
  let highlightsBrandSlug: string;
  let supabase: AnySupabaseClient;
  let testUserId: string;

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
    testUserId = testUser.id;

    // One brand per journey to avoid unique-pending-per-brand constraint.
    const ts = Date.now();

    async function seedBrand(label: string, slug: string) {
      const { data, error } = await supabase
        .from('brands')
        .insert({
          name: `[E2E-TEST] Brand Edit ${label} ${ts}`,
          slug,
          status: 'approved',
          description: initialDescription,
          purchase_links: [],
          social_links: {},
          retail_locations: [],
          product_photos: [],
        })
        .select('id')
        .single();

      if (error || !data) {
        throw new Error(`Failed to seed brand ${label}: ${error?.message}`);
      }

      const { error: ownerError } = await supabase.from('brand_owners').insert({
        user_id: testUserId,
        brand_id: data.id,
      });

      if (ownerError) {
        throw new Error(`Failed to seed brand_owners ${label}: ${ownerError.message}`);
      }

      return data.id as string;
    }

    descriptionBrandSlug = `e2e-edit-description-${ts}`;
    highlightsBrandSlug = `e2e-edit-highlights-${ts}`;

    [descriptionBrandId, highlightsBrandId] = await Promise.all([
      seedBrand('Description', descriptionBrandSlug),
      seedBrand('Highlights', highlightsBrandSlug),
    ]);
  });

  test.afterAll(async () => {
    const ids = [descriptionBrandId, highlightsBrandId].filter(Boolean);
    if (ids.length) {
      await supabase.from('pending_brand_edits').delete().in('brand_id', ids);
      await supabase.from('brand_owners').delete().in('brand_id', ids);
      await supabase.from('brands').delete().in('id', ids);
    }
  });

  test('owner can edit description and change persists', async ({ userPage }) => {
    test.setTimeout(120_000);

    // Navigate to the edit page
    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`, { timeout: 60_000 });

    // Confirm the edit form is loaded
    await expect(
      userPage.getByRole('heading', { name: /edit/i })
    ).toBeVisible({ timeout: 60_000 });

    // Wait for the seeded value to be hydrated, then clear and fill
    const descriptionField = userPage.locator('textarea[name="description"]');
    await expect(descriptionField).toBeVisible({ timeout: 5_000 });
    await expect(descriptionField).toHaveValue(initialDescription, { timeout: 5_000 });
    await descriptionField.fill('');
    await descriptionField.fill(updatedDescription);

    // Submit the form
    await userPage.getByRole('button', { name: '儲存變更' }).click();

    // Non-admin owner edit goes to review queue unless owner is trusted (≥3 approved edits).
    // E2E test brands have 0 approved edits, so always queued.
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i)
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit/);
  });

  test('owner can edit brand highlights and change persists', async ({ userPage }) => {
    test.setTimeout(120_000);

    const highlight = `[E2E-TEST] 亮點 ${Date.now()}`;

    await userPage.goto(`/dashboard/brands/${highlightsBrandSlug}/edit`, { timeout: 60_000 });

    const field = userPage.locator('textarea[name="brandHighlights"]');
    await expect(field).toBeVisible({ timeout: 60_000 });
    await field.fill(highlight);

    await userPage.getByRole('button', { name: '儲存變更' }).click();

    // Non-admin owner edit goes to review queue unless owner is trusted (≥3 approved edits).
    // E2E test brands have 0 approved edits, so always queued.
    await expect(
      userPage.getByText(/submitted for review|提交審核|審核中/i)
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit/);
  });
});
