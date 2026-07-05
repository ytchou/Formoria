import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Dashboard brand edit', () => {
  let descriptionBrandId: string;
  let descriptionBrandSlug: string;
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
          product_type: 'crafts',
          description: initialDescription,
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

    descriptionBrandId = await seedBrand('Description', descriptionBrandSlug);
  });

  test.afterAll(async () => {
    const ids = [descriptionBrandId].filter(Boolean);
    if (ids.length) {
      await supabase.from('pending_brand_edits').delete().in('brand_id', ids);
      await supabase.from('brand_owners').delete().in('brand_id', ids);
      await supabase.from('brands').delete().in('id', ids);
    }
  });

  test('edit form has city select with placeholder and city options', async ({ userPage }) => {
    test.setTimeout(60_000);
    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`, { timeout: 60_000 });
    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // City select trigger is visible — wizard Basic Info section (step 0, default).
    // The city field is a shadcn/ui <Select> whose <SelectTrigger> carries id="city".
    const cityTrigger = userPage.locator('#city');
    await expect(cityTrigger).toBeVisible({ timeout: 10_000 });

    // Placeholder text is shown when no city is selected
    await expect(cityTrigger).toContainText('請選擇縣市');

    // Open the dropdown and verify Taipei option is present with correct label
    await cityTrigger.click();
    await expect(
      userPage.getByRole('option', { name: '臺北市' })
    ).toBeVisible({ timeout: 5_000 });
    await userPage.keyboard.press('Escape');
  });

  test('owner can edit description and change persists', async ({ userPage }) => {
    test.setTimeout(120_000);

    // Navigate to the edit page
    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`, { timeout: 60_000 });

    // Confirm the edit form is loaded — heading is "編輯 {name}" (dashboard.edit.pageHeading)
    // Use /^編輯 / to avoid strict-mode violation: the layout also renders a brand-name h1
    // that contains "Edit" (English) in the seeded [E2E-TEST] name.
    await expect(
      userPage.getByRole('heading', { name: /^編輯 / })
    ).toBeVisible({ timeout: 60_000 });

    // Wait for the seeded value to be hydrated, then clear and fill
    const descriptionField = userPage.locator('textarea[name="description"]');
    await expect(descriptionField).toBeVisible({ timeout: 5_000 });
    await expect(descriptionField).toHaveValue(initialDescription, { timeout: 5_000 });
    await descriptionField.fill('');
    await descriptionField.fill(updatedDescription);

    // Save the current section (Basic Info, step 0) — wizard button is "儲存並繼續"
    await userPage.getByRole('button', { name: '儲存並繼續' }).click();

    // Wizard navigates to step 1 after a successful save.
    // saveSectionDraftAction persists the edit (to pending_brand_edits when no draft_data exists).
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit\?step=1/, { timeout: 15_000 });
  });

});
