import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// Minimal 1×1 transparent PNG (67 bytes)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Dashboard — brand image upload', () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let ownerUserId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);
    ownerUserId = testUser.id;

    const ts = Date.now();
    brandName = `[E2E-TEST] Image Upload ${ts}`;
    brandSlug = `e2e-image-upload-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: 'E2E throwaway — image upload test.',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`Failed to seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: ownerUserId,
      brand_id: brandId,
    });
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (brandId) {
      // This suite has one save journey for its brand, so it cannot hit the
      // unique-pending-per-brand constraint across tests; cleanup still removes queued edits.
      await supabase.from('moderation_flags').delete().eq('brand_id', brandId);
      await supabase.from('pending_brand_edits').delete().eq('brand_id', brandId);
      await supabase.from('brand_owners').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('owner can upload a hero image and the URL persists after save', async ({ userPage }) => {
    test.setTimeout(120_000);

    // Image upload is in the Media section — step 1 of the wizard.
    // Navigate directly to ?step=1 so the MediaSection (heroImageUrl) is visible.
    const editPath = `/dashboard/brands/${brandSlug}/edit?step=1`;
    const editResp = await userPage.goto(editPath, { timeout: 60_000 });
    if (editResp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // Confirm the form loaded
    await expect(
      userPage.getByRole('heading', { name: /edit|編輯/i })
    ).toBeVisible({ timeout: 60_000 });

    const heroInput = userPage.locator('#image-upload-heroImageUrl');

    // Intercept the upload API call BEFORE triggering the file-select
    const uploadResponsePromise = userPage.waitForResponse(
      (resp) => resp.url().includes('/api/upload') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    );

    // Attach the tiny PNG buffer as a File via setInputFiles (works on sr-only inputs)
    await heroInput.setInputFiles({
      name: 'test-hero.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // Wait for the upload API to respond
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(200);
    const uploadBody = await uploadResponse.json();
    expect(uploadBody).toHaveProperty('url');
    const uploadedUrl: string = uploadBody.url;
    expect(uploadedUrl).toBeTruthy();

    // Wait for upload SUCCESS: the button's visible TEXT transitions '上傳中...' → '更換'
    // (status-based, only after /api/upload resolves). Do NOT use getByRole(name:'更換圖片')
    // — that matches the aria-label, which is set at file-select time (localPreview) before
    // the upload completes. hasText matches rendered text content only ('更換', not the
    // aria-label '更換圖片').
    await expect(
      userPage.locator('button').filter({ hasText: '更換' }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Save & Continue at step 1 — wizard button (not the old single-form "儲存變更").
    // saveSectionDraftAction persists heroImageUrl to pending_brand_edits and navigates to step 2.
    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(userPage).toHaveURL(/\?step=2/, { timeout: 15_000 });

    const { data: pendingEdit } = await supabase
      .from('pending_brand_edits')
      .select('proposed_data')
      .eq('brand_id', brandId)
      .eq('status', 'pending')
      .single();

    expect((pendingEdit?.proposed_data as Record<string, unknown>)?.heroImageUrl).toBe(uploadedUrl);
  });
});
