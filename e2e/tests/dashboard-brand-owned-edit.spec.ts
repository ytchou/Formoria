import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as baseTest, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeAuthStorageStateForCredentials } from '../helpers/auth-session';
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

import { BUDGET, POLL } from '../budgets';
const test = baseTest.extend<{ userPage: Page }>({
  userPage: async ({ browser, isolatedUser }, provideFixture, testInfo) => {
    const storagePath = path.join(testInfo.outputDir, 'isolated-owner.json');
    await writeAuthStorageStateForCredentials(
      isolatedUser.email,
      isolatedUser.password,
      storagePath,
      'isolated-owner',
    );
    const context = await browser.newContext({ storageState: storagePath });
    const page = await context.newPage();
    await provideFixture(page);
    await context.close();
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// ─── Why one serial file? ────────────────────────────────────────────────────
//
// All tests here require one owner account to own the brand being edited.
// The `brand_owners` table has a UNIQUE constraint on `user_id` — only one
// brand per account. This file uses a worker-scoped throwaway account so its
// ownership transitions cannot race with the shared dashboard fixtures.
//
// test.describe.configure({ mode: 'serial' }) at FILE SCOPE forces every test
// in this file onto a SINGLE WORKER.  No cross-test ownership races are possible
// inside the file.
//
// Each describe section gets its OWN dedicated brand to avoid the single
// pending_brand_edits-per-brand unique constraint that fires when multiple
// "Save & Continue" saves target the same brand.
// ─────────────────────────────────────────────────────────────────────────────
test.describe.configure({ mode: 'serial' });

// Suite-level gate (DEV-1261). Declared at file scope so it runs before the
// seeding beforeAll hooks below: /dashboard/brands/<slug>/edit is unreachable
// while the flag is off. Probes the running app, never app_settings.
test.beforeAll(async ({ browser }) => {
  if (await ownerFeaturesDisabled(browser)) {
    test.skip(true, OWNER_FEATURES_OFF_REASON);
  }
});

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

test.beforeAll(async ({ isolatedUser }) => {
  supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);

  testUserId = isolatedUser.id;

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
      approved_at: new Date().toISOString(),
      mit_status: 'unverified',
      category: 'crafts',
      description: initialDescription,
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
      approved_at: new Date().toISOString(),
      category: 'crafts',
      description: '[E2E-TEST] Wizard test brand.',
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
      approved_at: new Date().toISOString(),
      category: 'crafts',
      description: '[E2E-TEST] Image upload test brand.',
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
      approved_at: new Date().toISOString(),
      mit_status: 'unverified',
      mit_declared_scope: 'most',
      mit_declared_at: '2026-07-22T01:02:03+00:00',
      mit_declared_by: testUserId,
      category: 'crafts',
      description: '[E2E-TEST] Initial governed description.',
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
      approved_at: new Date().toISOString(),
      category: 'crafts',
      description: '[E2E-TEST] Admin-owned brand for redirect guard test.',
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
    test.setTimeout(BUDGET.TEST.JOURNEY);
    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`);
    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const citySelect = userPage.locator('#city');
    await expect(citySelect).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(citySelect).toHaveValue('');
    await expect(citySelect.locator('option').first()).toHaveText('請選擇品牌創立城市');
    await expect(citySelect.locator('option[value="taipei"]')).toHaveText('臺北市');
  });

  test('owner can edit description and change persists', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await userPage.goto(`/dashboard/brands/${descriptionBrandSlug}/edit`);
    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const descriptionField = userPage.locator('textarea[name="description"]');
    await expect(descriptionField).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(descriptionField).toHaveValue(initialDescription, { timeout: BUDGET.RENDERED });
    await descriptionField.fill('');
    await descriptionField.fill(updatedDescription);

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(userPage).toHaveURL(/\/dashboard\/brands\/.+\/edit\?step=1/, {
      timeout: BUDGET.SERVER_RENDER,
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
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const resp = await userPage.goto(`/dashboard/brands/${wizardBrandSlug}/edit`);
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    await expect(userPage.locator('#main-content #basic-info')).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(userPage.getByRole('heading', { name: '編輯品牌資料' })).toBeVisible();
    await expect(userPage.getByText('已完成 0／4 步').first()).toBeVisible();
    await expect(
      userPage.locator('aside nav button').first(),
    ).toHaveAttribute('aria-current', 'step', { timeout: BUDGET.RENDERED });
    // `為必填欄位` is the tail of the required-fields legend, and RequiredFieldsHint
    // is rendered once per mounted step panel — so an unscoped match resolves to
    // several nodes as soon as the wizard mounts more than one. Scoped to the
    // active panel, which is the only one a reader can see (DEV-1414).
    await expect(
      userPage.locator('#basic-info').getByText('為必填欄位'),
    ).toBeVisible();
    await expect(userPage.locator('#description')).toHaveAttribute('aria-required', 'true');
    await expect(userPage.locator('#priceRange')).toHaveAttribute('aria-required', 'true');
  });

  test('sidebar shows all five step labels', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const resp = await userPage.goto(`/dashboard/brands/${wizardBrandSlug}/edit`);
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const sidebarNav = userPage.locator('aside nav');
    for (const label of ['基本資料', '品牌圖片', '社群與購買連結', '品牌口碑']) {
      await expect(
        sidebarNav.locator('button').filter({ hasText: label }),
      ).toBeVisible({ timeout: BUDGET.RENDERED });
    }
    await expect(sidebarNav.locator('button')).toHaveCount(4);
  });

  test('Save & Continue saves progress, survives reload, and advances to step 1 (Brand images)', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const nextName = `Reload Check ${Date.now()}`;

    const resp = await userPage.goto(`/dashboard/brands/${wizardBrandSlug}/edit`);
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(userPage.locator('#main-content #basic-info')).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    // Triple-click selects all text before fill to avoid appending to existing value
    await userPage.locator('#name').click({ clickCount: 3 });
    await userPage.locator('#name').fill(nextName);
    await userPage.locator('#priceRange').selectOption('2');

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    // Increase timeout: saveSectionDraftAction can be slow when dev server is under load
    await expect(userPage.locator('#main-content #media')).toBeVisible({ timeout: BUDGET.GATED_UI });

    // Poll for the draft save (async write after URL navigation)
    await expect.poll(async () => {
      const { data } = await supabase
        .from('brands')
        .select('draft_data')
        .eq('id', wizardBrandId)
        .single();
      return (data?.draft_data as Record<string, unknown>)?.__wizardCompletedSteps ?? null;
    }, POLL.UI).toEqual([0]);

    await userPage.reload();
    await expect(userPage.locator('#main-content #media')).toBeVisible({ timeout: BUDGET.GATED_UI });
    await expect(userPage.getByText('已完成 1／4 步').first()).toBeVisible();
    await expect(userPage.locator('aside nav button').first().locator('svg')).toHaveCount(1);
    // Back button visible on step 1 (non-first, non-final step)
    await expect(
      userPage.getByRole('button', { name: '上一步' }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    await userPage.locator('aside nav button').filter({ hasText: '基本資料' }).click();
    await expect(userPage.locator('#main-content #basic-info')).toBeVisible({ timeout: BUDGET.GATED_UI });
    await expect(userPage.locator('#name')).toHaveValue(nextName);
  });

  test('shared URL preview and link rows match the dashboard persistence flow', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const basicResp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=0`,
    );
    if (basicResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // Scoped to #main-content — unlike the bare field locators elsewhere in this
    // file, which are all preceded by a `#main-content #<section>` gate that has
    // already settled the navigation. This is the only field assertion that runs
    // straight off a goto, so a bare `#romanizedName` also matches the copy the
    // router stages outside the live tree, tripping strict mode with
    // "resolved to 2 elements".
    await expect(
      userPage.locator('#main-content #romanizedName'),
    ).toBeVisible({ timeout: BUDGET.GATED_UI });
    await expect(
      userPage.locator('#main-content #romanizedName'),
    ).toHaveAttribute('readonly', '');

    const linksResp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=2`,
    );
    if (linksResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.locator('#purchase fieldset')).toHaveCount(3);
    // 3 social + 4 purchase channels (PURCHASE_CHANNELS). Bump when a channel is added.
    await expect(userPage.locator('#purchase [data-platform-row]')).toHaveCount(7);
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
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const resp = await userPage.goto(
      `/dashboard/brands/${wizardBrandSlug}/edit?step=0`,
    );
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { name: /^編輯 / }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });
    await expect(userPage.locator('#main-content #basic-info')).toBeVisible({ timeout: BUDGET.GATED_UI });

    const sidebarNav = userPage.locator('aside nav');
    await sidebarNav.locator('button').filter({ hasText: '品牌口碑' }).click();
    await expect(userPage.locator('#main-content #reputation')).toBeVisible({ timeout: BUDGET.GATED_UI });
    await expect(userPage).toHaveURL(/\?step=3/, { timeout: BUDGET.INTERACTIVE });
    await expect(
      sidebarNav.locator('button').filter({ hasText: '品牌口碑' }),
    ).toHaveAttribute('aria-current', 'step', { timeout: BUDGET.RENDERED });
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
    test.setTimeout(BUDGET.TEST.ADMIN);
    const editPath = `/dashboard/brands/${imageUploadBrandSlug}/edit?step=1`;
    const editResp = await userPage.goto(editPath);
    if (editResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(
      userPage.getByRole('heading', { level: 1, name: /edit|編輯/i }),
    ).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const heroInput = userPage.locator('#image-upload-heroImageUrl');

    const uploadResponsePromise = userPage.waitForResponse(
      (resp) => resp.url().includes('/api/upload') && resp.request().method() === 'POST',
      { timeout: BUDGET.GATED_UI },
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
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(
      userPage.locator('#image-upload-heroImageUrl-replace').locator('..').getByRole('img'),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    const productInput = userPage.locator('#productPhotos-upload');
    const productUploadResponsePromise = userPage.waitForResponse(
      (resp) => resp.url().includes('/api/upload') && resp.request().method() === 'POST',
      { timeout: BUDGET.GATED_UI },
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
    await expect(userPage).toHaveURL(/\?step=2/, { timeout: BUDGET.SERVER_RENDER });

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
    test.setTimeout(BUDGET.TEST.ADMIN);
    // userPage owns governedBrand (layout renders children).
    // adminBrand is owned by adminUser — userPage is neither admin nor owner → redirect.
    const resp = await userPage.goto(`/dashboard/brands/${adminBrandSlug}/edit`);
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // /dashboard redirects to /dashboard/brands/<slug> client-side, so the final
    // URL is not /dashboard but /dashboard/brands/<slug>.  Assert stable state:
    // the user is somewhere in /dashboard (not on adminBrand's edit page) and
    // the edit form is not rendered.
    await expect(userPage).toHaveURL(/\/dashboard/, { timeout: BUDGET.NAVIGATION });
    await expect(userPage).not.toHaveURL(new RegExp(`/dashboard/brands/${adminBrandSlug}`), { timeout: BUDGET.RENDERED });
    await expect(userPage.locator('section#basic-info')).toHaveCount(0);
  });

  test('owner save does not mutate governed columns (mit_status, status)', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const editPath = `/dashboard/brands/${governedBrandSlug}/edit`;
    const editResp = await userPage.goto(editPath);
    if (editResp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('heading', { level: 1, name: /edit|編輯/i })).toBeVisible({ timeout: BUDGET.NAVIGATION });

    const descField = userPage.locator('textarea[name="description"]');
    await expect(descField).toBeVisible({ timeout: BUDGET.RENDERED });
    const updatedDesc = `[E2E-TEST] Updated via owner edit ${Date.now()}`;
    await descField.fill('');
    await descField.fill(updatedDesc);

    await userPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(userPage).toHaveURL(/\?step=1/, { timeout: BUDGET.SERVER_RENDER });

    // The wizard saves to brands.draft_data (camelCase keys), not pending_brand_edits.
    // pending_brand_edits is only created on final publish.
    await expect.poll(async () => {
      const { data } = await supabase
        .from('brands')
        .select('draft_data')
        .eq('id', governedBrandId)
        .single();
      return (data?.draft_data as Record<string, unknown>)?.description ?? null;
    }, POLL.UI).toBe(updatedDesc);

    const { data: row, error } = await supabase
      .from('brands')
      .select('mit_status, mit_declared_scope, mit_declared_at, mit_declared_by, status')
      .eq('id', governedBrandId)
      .single();
    expect(error).toBeNull();
    expect(row?.mit_status).toBe('unverified');
    expect(row?.mit_declared_scope).toBe('most');
    expect(row?.mit_declared_at).toBe('2026-07-22T01:02:03+00:00');
    expect(row?.mit_declared_by).toBe(testUserId);
    expect(row?.status).toBe('approved');
  });
});
