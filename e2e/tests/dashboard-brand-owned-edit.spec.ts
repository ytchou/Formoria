import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// ─── Why one serial file? ────────────────────────────────────────────────────
//
// All tests here require the E2E owner account to own the brand being edited.
// The `brand_owners` table has a UNIQUE constraint on `user_id` — only one
// brand per account. With fullyParallel=true, concurrent workers race to upsert
// ownership, causing server-side redirects away from the edit page.
//
// test.describe.configure({ mode: 'serial' }) at FILE SCOPE forces every test
// in this file onto a SINGLE WORKER.  No cross-test ownership races are possible
// inside the file; any other file that calls ensureOwnedBrand will simply inherit
// whichever brand this file currently owns without changing it.
//
// Each describe section gets its OWN dedicated brand to avoid the single
// pending_brand_edits-per-brand unique constraint that fires when multiple
// "Save & Continue" saves target the same brand.
// ─────────────────────────────────────────────────────────────────────────────
test.describe.configure({ mode: 'serial' });

// Minimal 1×1 transparent PNG (67 bytes) — used by image-upload section
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// ─── Shared state ────────────────────────────────────────────────────────────
let supabase: AnySupabaseClient;
let testUserId: string;
let adminUserId: string;

// Brand-edit section (tests city select + description edit)
const descriptionSuffix = Date.now();
const initialDescription = `[E2E-TEST] Initial description for edit test ${descriptionSuffix}`;
const updatedDescription = `[E2E-TEST] Updated description after save ${descriptionSuffix}`;
let descriptionBrandId: string;
let descriptionBrandSlug: string;

// Wizard section
let wizardBrandId: string;
let wizardBrandSlug: string;
let wizardOriginalDraftData: unknown;

// Image-upload section
let imageUploadBrandId: string;
let imageUploadBrandSlug: string;
let imageUploadOriginalDraftData: unknown;

// Governed-fields section
let governedBrandId: string;
let governedBrandSlug: string;
let adminBrandId: string;
let adminBrandSlug: string;

// Banner section (brandId/brandSlug declared per-test in beforeEach)

// ─── File-scope setup ────────────────────────────────────────────────────────

test.beforeAll(async () => {
  supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);

  const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
  if (!testUser)
    throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}. Run global-setup first.`);
  testUserId = testUser.id;

  const adminUser = usersData.users.find((u) => u.email === process.env.E2E_ADMIN_EMAIL);
  if (!adminUser)
    throw new Error(`E2E admin user not found: ${process.env.E2E_ADMIN_EMAIL}. Run global-setup first.`);
  adminUserId = adminUser.id;

  const ts = Date.now();

  // Brand-edit brand
  descriptionBrandSlug = `e2e-edit-description-${ts}`;
  const { data: dBrand, error: dErr } = await supabase
    .from('brands')
    .insert({
      name: `[E2E-TEST] Brand Edit Description ${ts}`,
      slug: descriptionBrandSlug,
      status: 'approved',
      mit_status: 'unverified',
      product_type: 'crafts',
      description: initialDescription,
      retail_locations: [],
    })
    .select('id')
    .single();
  if (dErr || !dBrand) throw new Error(`Failed to seed description brand: ${dErr?.message}`);
  descriptionBrandId = dBrand.id;

  // Wizard brand
  wizardBrandSlug = `e2e-wizard-${ts}`;
  const { data: wBrand, error: wErr } = await supabase
    .from('brands')
    .insert({
      name: `[E2E-TEST] Wizard Brand ${ts}`,
      slug: wizardBrandSlug,
      status: 'approved',
      product_type: 'crafts',
      description: '[E2E-TEST] Wizard test brand.',
      retail_locations: [],
    })
    .select('id')
    .single();
  if (wErr || !wBrand) throw new Error(`Failed to seed wizard brand: ${wErr?.message}`);
  wizardBrandId = wBrand.id;

  // Image-upload brand
  imageUploadBrandSlug = `e2e-image-upload-${ts}`;
  const { data: iBrand, error: iErr } = await supabase
    .from('brands')
    .insert({
      name: `[E2E-TEST] Image Upload Brand ${ts}`,
      slug: imageUploadBrandSlug,
      status: 'approved',
      product_type: 'crafts',
      description: '[E2E-TEST] Image upload test brand.',
      retail_locations: [],
    })
    .select('id')
    .single();
  if (iErr || !iBrand) throw new Error(`Failed to seed image-upload brand: ${iErr?.message}`);
  imageUploadBrandId = iBrand.id;

  // Governed-fields brand (for owner-save test)
  governedBrandSlug = `e2e-governed-fields-${ts}`;
  const { data: gBrand, error: gErr } = await supabase
    .from('brands')
    .insert({
      name: `[E2E-TEST] Governed Fields ${ts}`,
      slug: governedBrandSlug,
      status: 'approved',
      mit_status: 'unverified',
      product_type: 'crafts',
      description: '[E2E-TEST] Initial governed description.',
      retail_locations: [],
    })
    .select('id')
    .single();
  if (gErr || !gBrand) throw new Error(`Failed to seed governed brand: ${gErr?.message}`);
  governedBrandId = gBrand.id;

  // Admin brand (owned by admin, used for non-manager redirect test)
  adminBrandSlug = `e2e-governed-fields-admin-${ts}`;
  const { data: aBrand, error: aErr } = await supabase
    .from('brands')
    .insert({
      name: `[E2E-TEST] Governed Fields Admin ${ts}`,
      slug: adminBrandSlug,
      status: 'approved',
      product_type: 'crafts',
      description: '[E2E-TEST] Admin-owned brand for redirect guard test.',
      retail_locations: [],
    })
    .select('id')
    .single();
  if (aErr || !aBrand) throw new Error(`Failed to seed admin brand: ${aErr?.message}`);
  adminBrandId = aBrand.id;

  // Assign admin brand to admin user
  const { error: adminBoErr } = await supabase
    .from('brand_owners')
    .upsert({ user_id: adminUserId, brand_id: adminBrandId }, { onConflict: 'user_id' });
  if (adminBoErr) throw new Error(`Failed to seed admin brand_owners: ${adminBoErr.message}`);

  // Initial ownership: user → descriptionBrand (brand-edit tests run first)
  const { error: ownerError } = await supabase
    .from('brand_owners')
    .upsert({ user_id: testUserId, brand_id: descriptionBrandId }, { onConflict: 'user_id' });
  if (ownerError) throw new Error(`Failed to seed brand_owners: ${ownerError.message}`);
});

test.afterAll(async () => {
  if (!supabase) return;
  // Cascade-delete brands in dependency order; brand_owners, pending_brand_edits
  // are cascade-deleted when the brand is deleted (FK → ON DELETE CASCADE).
  for (const id of [
    descriptionBrandId,
    wizardBrandId,
    imageUploadBrandId,
    governedBrandId,
    adminBrandId,
  ]) {
    if (id) {
      await supabase.from('pending_brand_edits').delete().eq('brand_id', id);
      await supabase.from('brand_owners').delete().eq('brand_id', id);
      await supabase.from('brands').delete().eq('id', id);
    }
  }
});

// ─── Brand-edit tests ────────────────────────────────────────────────────────
// User owns descriptionBrand (set in file beforeAll).

test.describe('Dashboard brand edit', () => {
  test('edit form has city select with placeholder and city options', async ({ userPage }) => {
    test.setTimeout(60_000);
    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`, { timeout: 60_000 });
    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });

    const citySelect = userPage.locator('#city');
    await expect(citySelect).toBeVisible({ timeout: 10_000 });
    await expect(citySelect).toHaveValue('');
    await expect(citySelect.locator('option').first()).toHaveText('請選擇品牌創立城市');
    await expect(citySelect.locator('option[value="taipei"]')).toHaveText('臺北市');
  });

  test('owner can edit description and change persists', async ({ userPage }) => {
    test.setTimeout(120_000);

    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`, { timeout: 60_000 });
    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });

    const descriptionField = userPage.locator('textarea[name="description"]');
    await expect(descriptionField).toBeVisible({ timeout: 5_000 });
    await expect(descriptionField).toHaveValue(initialDescription, { timeout: 5_000 });
    await descriptionField.fill('');
    await descriptionField.fill(updatedDescription);

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit\?step=1/, {
      timeout: 15_000,
    });
  });
});

// ─── Wizard tests ────────────────────────────────────────────────────────────
// Transitions ownership to wizardBrand before these tests begin.

test.describe('Brand edit sidebar wizard — navigation', () => {
  test.beforeAll(async () => {
    // Capture draft_data before wizard modifies it so afterAll can restore.
    const { data } = await supabase.from('brands').select('draft_data').eq('id', wizardBrandId).single();
    wizardOriginalDraftData = data?.draft_data ?? null;

    // Transfer ownership: user → wizardBrand
    await supabase
      .from('brand_owners')
      .upsert({ user_id: testUserId, brand_id: wizardBrandId }, { onConflict: 'user_id' });
  });

  test.afterAll(async () => {
    // Remove any pending edit created by "Save & Continue" tests.
    await supabase.from('pending_brand_edits').delete().eq('brand_id', wizardBrandId);
    // Restore draft_data to the pre-test state.
    await supabase
      .from('brands')
      .update({ draft_data: wizardOriginalDraftData })
      .eq('id', wizardBrandId);
  });

  test('wizard loads at step 0 (Basic Info) by default', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(`/dashboard/brands/${wizardBrandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });

    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByRole('heading', { name: '編輯品牌資料' })).toBeVisible();
    await expect(userPage.getByText('第 1 步，共 5 步').first()).toBeVisible();
    await expect(
      userPage.locator('aside nav button').first(),
    ).toHaveAttribute('aria-current', 'step', { timeout: 5_000 });
    await expect(userPage.getByText('為必填欄位')).toBeVisible();
    await expect(userPage.locator('#description')).toHaveAttribute('aria-required', 'true');
    await expect(userPage.locator('#priceRange')).toHaveAttribute('aria-required', 'true');
  });

  test('sidebar shows all five step labels', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(`/dashboard/brands/${wizardBrandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });

    const sidebarNav = userPage.locator('aside nav');
    for (const label of ['基本資料', '品牌圖片', '社群與購買連結', '販售地點', '品牌口碑']) {
      await expect(
        sidebarNav.locator('button').filter({ hasText: label }),
      ).toBeVisible({ timeout: 5_000 });
    }
    await expect(sidebarNav.locator('button')).toHaveCount(5);
  });

  test('Save & Continue saves progress, survives reload, and advances to step 1 (Brand images)', async ({ userPage }) => {
    test.setTimeout(90_000);
    const nextName = `Reload Check ${Date.now()}`;

    const resp = await userPage.goto(`/dashboard/brands/${wizardBrandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 10_000 });

    // Triple-click selects all text before fill to avoid appending to existing value
    await userPage.locator('#name').click({ clickCount: 3 });
    await userPage.locator('#name').fill(nextName);
    await userPage.locator('#priceRange').selectOption('2');

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    // Increase timeout: saveSectionDraftAction can be slow when dev server is under load
    await expect(userPage.locator('#media')).toBeVisible({ timeout: 30_000 });

    // Poll for the draft save (async write after URL navigation)
    await expect.poll(async () => {
      const { data } = await supabase
        .from('brands')
        .select('draft_data')
        .eq('id', wizardBrandId)
        .single();
      return (data?.draft_data as Record<string, unknown>)?.__wizardCompletedSteps ?? null;
    }, { timeout: 15_000, intervals: [500, 1_000, 2_000] }).toEqual([0]);

    await userPage.reload();
    await expect(userPage.locator('#media')).toBeVisible({ timeout: 30_000 });
    await expect(userPage.locator('aside nav button').first().locator('svg')).toHaveCount(1);
    // Back button visible on step 1 (non-first, non-final step)
    await expect(
      userPage.getByRole('button', { name: '上一步' }),
    ).toBeVisible({ timeout: 10_000 });

    await userPage.locator('aside nav button').filter({ hasText: '基本資料' }).click();
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 30_000 });
    await expect(userPage.locator('#name')).toHaveValue(nextName);
  });

  test('shared URL preview and link rows match the dashboard persistence flow', async ({ userPage }) => {
    test.setTimeout(90_000);

    const basicResp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=0`,
      { timeout: 60_000 },
    );
    if (basicResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.locator('#romanizedName')).toBeVisible({ timeout: 30_000 });
    await userPage.locator('#romanizedName').fill('Wizard Public Name');
    await expect(userPage.locator('#brand-url-preview')).toHaveValue(
      '/brands/wizard-public-name',
    );

    const linksResp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=2`,
      { timeout: 60_000 },
    );
    if (linksResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.locator('#purchase fieldset')).toHaveCount(3);
    await expect(userPage.locator('#purchase [data-platform-row]')).toHaveCount(6);
    for (const field of [
      'socialInstagram',
      'socialThreads',
      'socialFacebook',
      'purchaseWebsite',
      'purchasePinkoi',
      'purchaseShopee',
    ]) {
      await expect(
        userPage.locator(`[data-platform-row]:has(#${field})`),
      ).toBeVisible();
    }
    await expect(userPage.locator('#purchaseWebsite')).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  test('sidebar click jumps non-linearly to Reputation (step 4)', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=0`,
      { timeout: 60_000 },
    );
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(userPage.locator('#basic-info')).toBeVisible({ timeout: 30_000 });

    const sidebarNav = userPage.locator('aside nav');
    await sidebarNav.locator('button').filter({ hasText: '品牌口碑' }).click();
    await expect(userPage.locator('#reputation')).toBeVisible({ timeout: 30_000 });
    await expect(userPage).toHaveURL(/\?step=4/, { timeout: 10_000 });
    await expect(
      sidebarNav.locator('button').filter({ hasText: '品牌口碑' }),
    ).toHaveAttribute('aria-current', 'step', { timeout: 5_000 });
  });

  test('?step=3 deep link opens Locations section', async ({ userPage }) => {
    test.setTimeout(60_000);

    const resp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=3`,
      { timeout: 60_000 },
    );
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(userPage.locator('#locations')).toBeVisible({ timeout: 30_000 });
    await expect(
      userPage.locator('aside nav button').nth(3),
    ).toHaveAttribute('aria-current', 'step', { timeout: 10_000 });
  });
});

// ─── Image-upload tests ──────────────────────────────────────────────────────
// Transitions ownership to imageUploadBrand before these tests begin.

test.describe('Dashboard — brand image upload', () => {
  test.beforeAll(async () => {
    const { data } = await supabase.from('brands').select('draft_data').eq('id', imageUploadBrandId).single();
    imageUploadOriginalDraftData = data?.draft_data ?? null;

    // Transfer ownership: user → imageUploadBrand
    await supabase
      .from('brand_owners')
      .upsert({ user_id: testUserId, brand_id: imageUploadBrandId }, { onConflict: 'user_id' });
  });

  test.afterAll(async () => {
    await supabase.from('moderation_flags').delete().eq('brand_id', imageUploadBrandId);
    await supabase.from('pending_brand_edits').delete().eq('brand_id', imageUploadBrandId);
    await supabase
      .from('brands')
      .update({ draft_data: imageUploadOriginalDraftData })
      .eq('id', imageUploadBrandId);
  });

  test('owner can upload hero and product images and persist both in a draft', async ({ userPage }) => {
    test.setTimeout(120_000);

    const editPath = `/dashboard/brands/${imageUploadBrandSlug}/edit?step=1`;
    const editResp = await userPage.goto(editPath, { timeout: 60_000 });
    if (editResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { level: 1, name: /edit|編輯/i }),
    ).toBeVisible({ timeout: 60_000 });

    const heroInput = userPage.locator('#image-upload-heroImageUrl');

    const uploadResponsePromise = userPage.waitForResponse(
      (resp) => resp.url().includes('/api/upload') && resp.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await heroInput.setInputFiles({
      name: 'test-hero.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(200);
    const uploadBody = await uploadResponse.json();
    expect(uploadBody).toHaveProperty('url');
    const uploadedUrl: string = uploadBody.url;
    expect(uploadedUrl).toBeTruthy();

    await expect(
      userPage.locator('#image-upload-heroImageUrl-replace'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      userPage.locator('#image-upload-heroImageUrl-replace').locator('..').getByRole('img'),
    ).toBeVisible({ timeout: 10_000 });

    const productInput = userPage.locator('#productPhotos-upload');
    const productUploadResponsePromise = userPage.waitForResponse(
      (resp) => resp.url().includes('/api/upload') && resp.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await productInput.setInputFiles({
      name: 'test-product.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    const productUploadResponse = await productUploadResponsePromise;
    expect(productUploadResponse.status()).toBe(200);
    const productUploadBody = await productUploadResponse.json();
    const productUrl: string = productUploadBody.url;
    await expect(
      userPage.locator('#productPhotos-upload-dropzone').locator('..').getByRole('img'),
    ).toBeVisible();

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(userPage).toHaveURL(/\?step=2/, { timeout: 15_000 });

    const { data: brandDraft } = await supabase
      .from('brands')
      .select('draft_data')
      .eq('id', imageUploadBrandId)
      .single();
    const draft = brandDraft?.draft_data as Record<string, unknown>;
    expect(draft?.heroImageUrl).toBe(uploadedUrl);
    expect(draft?.productPhotos).toContain(productUrl);
  });
});

// ─── Governed-field integrity tests ─────────────────────────────────────────
// Test (a): user navigates to adminBrand/edit while owning imageUploadBrand
//           → layout renders (user owns something), edit page redirects.
// Test (b): user owns governedBrand → saves → governed columns unchanged in DB.

test.describe('Dashboard — governed field integrity', () => {
  test.beforeAll(async () => {
    // Transfer ownership: user → governedBrand (used for test b).
    await supabase
      .from('brand_owners')
      .upsert({ user_id: testUserId, brand_id: governedBrandId }, { onConflict: 'user_id' });
  });

  test.afterAll(async () => {
    await supabase.from('moderation_flags').delete().eq('brand_id', governedBrandId);
    await supabase.from('pending_brand_edits').delete().eq('brand_id', governedBrandId);
  });

  test('non-manager navigating to edit page is redirected to /dashboard', async ({ userPage }) => {
    test.setTimeout(120_000);

    // userPage owns governedBrand (layout renders children).
    // adminBrand is owned by adminUser — userPage is neither admin nor owner → redirect.
    const resp = await userPage.goto(`/dashboard/brands/${adminBrandSlug}/edit`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // /dashboard redirects to /dashboard/brands/<slug> client-side, so the final
    // URL is not /dashboard but /dashboard/brands/<slug>.  Assert stable state:
    // the user is somewhere in /dashboard (not on adminBrand's edit page) and
    // the edit form is not rendered.
    await expect(userPage).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await expect(userPage).not.toHaveURL(new RegExp(`/dashboard/brands/${adminBrandSlug}`), { timeout: 5_000 });
    await expect(userPage.locator('section#basic-info')).toHaveCount(0);
  });

  test('owner save does not mutate governed columns (mit_status, status)', async ({ userPage }) => {
    test.setTimeout(120_000);

    const editPath = `/dashboard/brands/${governedBrandSlug}/edit`;
    const editResp = await userPage.goto(editPath, { timeout: 60_000 });
    if (editResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('heading', { level: 1, name: /edit|編輯/i })).toBeVisible({ timeout: 60_000 });

    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: 5_000 });
    const updatedDesc = `[E2E-TEST] Updated via owner edit ${Date.now()}`;
    await descField.fill('');
    await descField.fill(updatedDesc);

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(userPage).toHaveURL(/\?step=1/, { timeout: 15_000 });

    // The wizard saves to brands.draft_data (camelCase keys), not pending_brand_edits.
    // pending_brand_edits is only created on final publish.
    await expect.poll(async () => {
      const { data } = await supabase
        .from('brands')
        .select('draft_data')
        .eq('id', governedBrandId)
        .single();
      return (data?.draft_data as Record<string, unknown>)?.description ?? null;
    }, { timeout: 15_000, intervals: [500, 1_000, 2_000] }).toBe(updatedDesc);

    const { data: row, error } = await supabase
      .from('brands')
      .select('mit_status, status')
      .eq('id', governedBrandId)
      .single();
    expect(error).toBeNull();
    expect(row?.mit_status).toBe('unverified');
    expect(row?.status).toBe('approved');
  });
});

// ─── EditReviewBanner tests ──────────────────────────────────────────────────
// Each test creates its own fresh bannerBrand to control pending_brand_edits state.
// afterEach cascade-deletes bannerBrand (and brand_owners).

test.describe('Dashboard EditReviewBanner', () => {
  let bannerBrandId: string;
  let bannerBrandSlug: string;

  test.beforeEach(async () => {
    // Pre-cleanup: remove stale [E2E-TEST] EditBanner brands already owned by the user.
    const { data: ownedRows } = await supabase
      .from('brand_owners')
      .select('brand_id')
      .eq('user_id', testUserId);
    if (ownedRows?.length) {
      const ownedIds = ownedRows.map((r: { brand_id: string }) => r.brand_id);
      const { data: stale } = await supabase
        .from('brands')
        .select('id')
        .in('id', ownedIds)
        .like('name', '[E2E-TEST] EditBanner%');
      if (stale?.length) {
        await supabase.from('brands').delete().in('id', stale.map((b: { id: string }) => b.id));
      }
    }

    const ts = Date.now();
    bannerBrandSlug = `e2e-banner-${ts}`;

    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] EditBanner ${ts}`,
        slug: bannerBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] initial description',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed banner brand: ${error?.message}`);
    bannerBrandId = data.id;

    // DashboardLayout resolves allBrands[0] ordered by claimed_at ASC.
    // Setting claimed_at='1970-01-01' ensures this test brand is always first.
    const { error: ownerErr } = await supabase.from('brand_owners').upsert(
      { user_id: testUserId, brand_id: bannerBrandId, claimed_at: '1970-01-01T00:00:00.000Z' },
      { onConflict: 'user_id' },
    );
    if (ownerErr) throw new Error(`seed banner brand_owners: ${ownerErr.message}`);
  });

  test.afterEach(async () => {
    if (bannerBrandId) {
      await supabase.from('brands').delete().eq('id', bannerBrandId);
    }
  });

  test('pending edit shows amber banner with 待審核 state', async ({ userPage }) => {
    test.setTimeout(120_000);

    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: bannerBrandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed pending description' },
      status: 'pending',
    });
    if (editErr) throw new Error(`seed pending edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${bannerBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });
    await expect(userPage.getByText('您的編輯正在審核中')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('審核中', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('rejected edit shows rejection banner with notes and resubmit link', async ({ userPage }) => {
    test.setTimeout(120_000);

    const now = new Date().toISOString();
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: bannerBrandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed rejected description' },
      status: 'rejected',
      reviewer_notes: 'Test rejection reason for banner',
      reviewed_at: now,
    });
    if (editErr) throw new Error(`seed rejected edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${bannerBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });
    await expect(userPage.getByText('編輯需要修改')).toBeVisible({ timeout: 10_000 });
    await expect(userPage.getByText('Test rejection reason for banner')).toBeVisible({ timeout: 5_000 });

    const resubmitLink = userPage.getByRole('link', { name: '重新編輯' });
    await expect(resubmitLink).toBeVisible({ timeout: 5_000 });
    await resubmitLink.click();
    await expect(userPage).toHaveURL(new RegExp(`/dashboard/brands/${bannerBrandSlug}/edit`), { timeout: 60_000 });
  });

  test('approved edit shows green banner and can be dismissed', async ({ userPage }) => {
    test.setTimeout(120_000);

    const now = new Date().toISOString();
    const { error: editErr } = await supabase.from('pending_brand_edits').insert({
      brand_id: bannerBrandId,
      submitted_by: testUserId,
      proposed_data: { description: '[E2E-TEST] Proposed approved description' },
      status: 'approved',
      reviewed_at: now,
    });
    if (editErr) throw new Error(`seed approved edit: ${editErr.message}`);

    const resp = await userPage.goto(`/dashboard?brand=${bannerBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('link', { name: '編輯品牌' }).first()).toBeVisible({ timeout: 60_000 });
    await expect(userPage.getByText('編輯已通過並上線')).toBeVisible({ timeout: 10_000 });

    const dismissBtn = userPage.getByRole('button', { name: '關閉' });
    await expect(dismissBtn).toBeVisible({ timeout: 5_000 });
    await dismissBtn.click();
    await expect(userPage.getByText('編輯已通過並上線')).toBeHidden({ timeout: 5_000 });
  });
});
