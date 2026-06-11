import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe.serial('Dashboard brand draft preview', () => {
  let brandId: string;
  let brandSlug: string;
  let supabase: AnySupabaseClient;
  let previewGateActive = false;

  const ts = Date.now();
  const oldDescription = `[E2E-TEST] Old description before draft ${ts}`;
  const newDescription = `[E2E-TEST] New draft description ${ts}`;

  test.beforeAll(async ({ request }) => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if PREVIEW_MODE 503 gate is active
    const probe = await request.get('/brands');
    previewGateActive = probe.status() === 503;

    // Look up the E2E test user
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

    // Seed the brand
    brandSlug = `e2e-draft-preview-${ts}`;
    const { data: brandData, error: brandError } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Draft Preview ${ts}`,
        slug: brandSlug,
        status: 'approved',
        description: oldDescription,
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

    // Link ownership
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

  test('step 1 — owner saves a draft and sees the draft-pending banner', async ({ userPage }) => {
    // DEV-762: dashboard/brands/[slug]/edit cold-compiles in CI dev mode; give generous budget
    test.setTimeout(60_000);
    await userPage.goto(`/dashboard/brands/${brandSlug}/edit`);

    const descriptionField = userPage.locator('textarea[name="description"]');
    await expect(descriptionField).toBeVisible({ timeout: 30_000 });
    await expect(descriptionField).toHaveValue(oldDescription, { timeout: 5_000 });

    await descriptionField.fill('');
    await descriptionField.fill(newDescription);

    await userPage.getByRole('button', { name: '儲存草稿' }).click();

    await expect(userPage.getByText('草稿待發布')).toBeVisible({ timeout: 10_000 });
  });

  test('step 2 — anon sees the OLD live description on the public brand page', async ({ anonPage }) => {
    test.skip(previewGateActive, 'PREVIEW_MODE active — public brand page returns 503');

    await anonPage.goto(`/brands/${brandSlug}`);
    await expect(anonPage.getByText(oldDescription)).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText(newDescription)).toHaveCount(0);
  });

  test('step 3 — owner sees draft description and preview banner on ?preview=1', async ({ userPage }) => {
    await userPage.goto(`/brands/${brandSlug}?preview=1`);

    await expect(userPage.getByText(newDescription)).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('預覽模式 — 尚未發布')).toBeVisible({ timeout: 5_000 });
  });

  test('step 4 — anon on ?preview=1 sees OLD description, no preview banner, no draft content', async ({ anonPage }) => {
    test.skip(previewGateActive, 'PREVIEW_MODE active — public brand page returns 503');

    await anonPage.goto(`/brands/${brandSlug}?preview=1`);

    await expect(anonPage.getByText(oldDescription)).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText(newDescription)).toHaveCount(0);
    await expect(anonPage.getByText('預覽模式 — 尚未發布')).toHaveCount(0);
  });

  test('step 5 — owner publishes draft and public page eventually shows NEW description', async ({ userPage, anonPage }) => {
    test.skip(previewGateActive, 'PREVIEW_MODE active — public brand page returns 503');

    // Navigate to the edit page to find the draft-pending banner with the publish button
    await userPage.goto(`/dashboard/brands/${brandSlug}/edit`);
    await expect(userPage.getByText('草稿待發布')).toBeVisible({ timeout: 10_000 });

    await userPage.getByRole('button', { name: '發布' }).click();

    // Poll-reload the public page until ISR/revalidation serves the new content
    await expect(async () => {
      await anonPage.goto(`/brands/${brandSlug}`);
      await expect(anonPage.getByText(newDescription)).toBeVisible();
    }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 3_000, 5_000] });

    // Draft-pending banner should be gone from the edit page
    await userPage.goto(`/dashboard/brands/${brandSlug}/edit`);
    await expect(userPage.getByText('草稿待發布')).toHaveCount(0);
  });
});
