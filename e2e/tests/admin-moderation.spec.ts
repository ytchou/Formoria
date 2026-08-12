import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as baseTest, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeAuthStorageStateForCredentials } from '../helpers/auth-session';
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

import { BUDGET } from '../budgets';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const test = baseTest.extend<{ ownerPage: Page }>({
  ownerPage: async ({ browser, isolatedUser }, use, testInfo) => {
    const storagePath = path.join(testInfo.outputDir, 'moderation-owner.json');
    await writeAuthStorageStateForCredentials(
      isolatedUser.email,
      isolatedUser.password,
      storagePath,
      'moderation-owner',
    );
    const context = await browser.newContext({ storageState: storagePath });
    const page = await context.newPage();
    // Playwright fixture callbacks expose a `use` continuation that triggers the React hook rule.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    await context.close();
  },
});

test.describe.configure({ mode: 'serial' });

// Suite-level gate (DEV-1261). Every journey here drives the OWNER edit wizard
// at /dashboard/brands/<slug>/edit as a non-admin owner, and that route 404s
// while the flag is off — the admin exemption does not apply to `ownerPage`.
// Declared at file scope so it runs before the seeding beforeAll below. Probes
// the running app, never app_settings.
test.beforeAll(async ({ browser }) => {
  if (await ownerFeaturesDisabled(browser)) {
    test.skip(true, OWNER_FEATURES_OFF_REASON);
  }
});

test.describe('Content moderation flow', () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const admins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase());
    test.skip(
      !adminEmail || !admins.includes(adminEmail.toLowerCase()),
      'Admin E2E tests require E2E_ADMIN_EMAIL to be included in ADMIN_EMAILS',
    );
  });

  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandSlug: string;
  let brandName: string;
  let ownerId: string;
  let cleanDescription: string;
  let ownerBlockedFlagId: string;
  let adminBlockedFlagId: string;

  test.beforeAll(async ({ isolatedUser }) => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    ownerId = isolatedUser.id;

    const timestamp = Date.now();
    brandSlug = `e2e-moderation-flow-${timestamp}`;
    brandName = `[E2E-TEST] Moderation flow ${timestamp}`;
    cleanDescription = `台灣手工製作木質生活用品，耐用溫潤，適合日常使用 ${timestamp}`;
    const heroUrl = `https://cdn.example.com/${brandSlug}/hero.webp`;
    const productUrl = `https://cdn.example.com/${brandSlug}/product.webp`;

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        romanized_name: `E2E Moderation Flow ${timestamp}`,
        status: 'approved',
        approved_at: new Date().toISOString(),
        product_type: 'crafts',
        product_tags: ['木工'],
        price_range: 2,
        founding_year: 2020,
        description: cleanDescription,
        hero_image_url: heroUrl,
        purchase_website: `https://${brandSlug}.example.com`,
      })
      .select('id')
      .single();
    if (brandError || !brand) {
      throw new Error(`Failed to seed moderation brand: ${brandError?.message}`);
    }
    brandId = brand.id;

    const { error: ownerError } = await supabase
      .from('brand_owners')
      .insert({ brand_id: brandId, user_id: ownerId });
    if (ownerError) {
      throw new Error(`Failed to seed moderation owner: ${ownerError.message}`);
    }

    const { error: imageError } = await supabase.from('brand_images').insert([
      {
        brand_id: brandId,
        url: heroUrl,
        source_url: heroUrl,
        source: 'legacy',
        status: 'active',
        sort_order: 0,
      },
      {
        brand_id: brandId,
        url: productUrl,
        source_url: productUrl,
        source: 'legacy',
        status: 'active',
        sort_order: 1,
      },
    ]);
    if (imageError) {
      throw new Error(`Failed to seed moderation images: ${imageError.message}`);
    }
  });

  test.afterAll(async () => {
    if (!supabase || !brandId) return;
    await supabase.from('moderation_flags').delete().eq('brand_id', brandId);
    await supabase.from('brand_owners').delete().eq('brand_id', brandId);
    await supabase.from('brands').delete().eq('id', brandId);
  });

  async function saveBasicInfoDraft(ownerPage: Page, description: string) {
    await ownerPage.goto(`/zh-TW/dashboard/brands/${brandSlug}/edit?step=0`);
    await expect(ownerPage.locator('#description')).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await expect(ownerPage.locator('#name')).toHaveValue(brandName, {
      timeout: BUDGET.GATED_UI,
    });
    await expect(ownerPage.locator('#productType')).toHaveValue('crafts', {
      timeout: BUDGET.GATED_UI,
    });
    await expect(ownerPage.locator('#priceRange')).toHaveValue('2', {
      timeout: BUDGET.GATED_UI,
    });
    await ownerPage.locator('#description').fill(description);
    await ownerPage.getByRole('button', { name: '儲存並繼續' }).click();
    await expect(ownerPage.getByRole('heading', { name: '產品圖片' })).toBeVisible({
      timeout: BUDGET.NAVIGATION,
    });
    await expect
      .poll(
        async () => {
          const { data, error } = await supabase
            .from('brands')
            .select('draft_data')
            .eq('id', brandId)
            .single();
          expect(error).toBeNull();
          return (data?.draft_data as Record<string, unknown> | null)
            ?.description;
        },
        { timeout: BUDGET.GATED_UI, intervals: [500, 1_000, 2_000] },
      )
      .toBe(description);
  }

  async function publishDraft(ownerPage: Page) {
    await ownerPage.goto(`/zh-TW/dashboard/brands/${brandSlug}/edit?step=4`);
    await expect(ownerPage.getByRole('button', { name: '發布' })).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await ownerPage.getByRole('button', { name: '發布' }).click();
  }

  test('clean owner edit publishes immediately', async ({ ownerPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const updatedDescription = `${cleanDescription}，新增耐用設計說明`;

    await saveBasicInfoDraft(ownerPage, updatedDescription);
    await publishDraft(ownerPage);

    await expect
      .poll(
        async () => {
          const { data, error } = await supabase
            .from('brands')
            .select('description, draft_data')
            .eq('id', brandId)
            .single();
          expect(error).toBeNull();
          return {
            description: data?.description,
            draftData: data?.draft_data,
          };
        },
        { timeout: BUDGET.GATED_UI, intervals: [500, 1_000, 2_000] },
      )
      .toEqual({ description: updatedDescription, draftData: null });

    const { data: flags, error: flagsError } = await supabase
      .from('moderation_flags')
      .select('id')
      .eq('brand_id', brandId);
    expect(flagsError).toBeNull();
    expect(flags).toEqual([]);

    await ownerPage.goto(`/zh-TW/brands/${brandSlug}`);
    await expect(ownerPage.getByText(updatedDescription, { exact: true })).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
  });

  test('blocked owner edit shows localized guidance and stays unpublished', async ({
    ownerPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const blockedDescription = `${cleanDescription}，聯絡電話 0912345678`;

    await saveBasicInfoDraft(ownerPage, blockedDescription);
    await publishDraft(ownerPage);

    await expect(ownerPage.getByRole('heading', { name: '基本資料' })).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await expect(ownerPage.locator('#description-error')).toHaveText(
      /此欄位不可放電話號碼/,
      { timeout: BUDGET.GATED_UI },
    );

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('description, draft_data')
      .eq('id', brandId)
      .single();
    expect(brandError).toBeNull();
    expect(brand?.description).toBe(`${cleanDescription}，新增耐用設計說明`);
    expect((brand?.draft_data as Record<string, unknown>)?.description).toBe(
      blockedDescription,
    );

    await ownerPage.goto(`/zh-TW/brands/${brandSlug}`);
    await expect(
      ownerPage.getByText(`${cleanDescription}，新增耐用設計說明`, {
        exact: true,
      }),
    ).toBeVisible({ timeout: BUDGET.GATED_UI });
    await expect(ownerPage.getByText(blockedDescription, { exact: true })).toHaveCount(0);

    const { data: flags, error: flagsError } = await supabase
      .from('moderation_flags')
      .select('id, field_name, flag_reason, status')
      .eq('brand_id', brandId)
      .eq('status', 'pending');
    expect(flagsError).toBeNull();
    expect(flags).toHaveLength(1);
    const ownerFlag = flags?.at(0);
    expect(ownerFlag).toMatchObject({
      field_name: 'description',
      flag_reason: 'contact_injection_phone',
      status: 'pending',
    });
    ownerBlockedFlagId = ownerFlag?.id ?? '';
  });

  test('admin cannot bypass the block and can review the resulting queue rows', async ({
    adminPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto('/admin/brands');
    await adminPage.getByPlaceholder('Search brand name...').fill(brandName);
    const brandRow = adminPage.locator('tbody tr').filter({ hasText: brandName });
    await expect(brandRow).toBeVisible({ timeout: BUDGET.GATED_UI });
    await brandRow.getByText(brandName, { exact: true }).click();

    const brandPanel = adminPage.getByRole('dialog', { name: brandName });
    await expect(brandPanel).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    const contentSection = brandPanel.locator('section').filter({
      has: brandPanel.getByRole('heading', { name: 'Content', exact: true }),
    });
    await contentSection.getByRole('button', { name: 'Edit' }).click();
    await contentSection
      .getByLabel('Description')
      .fill(`${cleanDescription}，管理員電話 0912345678`);
    await contentSection.getByRole('button', { name: 'Save' }).click();
    await expect(brandPanel).toContainText(
      'Phone numbers are not allowed in this field',
      { timeout: BUDGET.GATED_UI },
    );

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('description')
      .eq('id', brandId)
      .single();
    expect(brandError).toBeNull();
    expect(brand?.description).toBe(`${cleanDescription}，新增耐用設計說明`);

    const { data: pendingFlags, error: pendingFlagsError } = await supabase
      .from('moderation_flags')
      .select('id, field_name, flag_reason, status')
      .eq('brand_id', brandId)
      .eq('status', 'pending');
    expect(pendingFlagsError).toBeNull();
    expect(pendingFlags).toHaveLength(2);
    const adminFlag = pendingFlags?.find(
      (flag) => flag.id !== ownerBlockedFlagId,
    );
    expect(adminFlag).toMatchObject({
      field_name: 'description',
      flag_reason: 'contact_injection_phone',
      status: 'pending',
    });
    adminBlockedFlagId = adminFlag?.id ?? '';

    await adminPage.goto('/admin/moderation');
    // One queue table on this page, asserted rather than assumed: every row
    // locator below hangs off it, and a second table appearing would silently
    // double every count instead of failing.
    const queueTable = adminPage.locator('table');
    await expect(queueTable).toHaveCount(1, { timeout: BUDGET.GATED_UI });
    // No explicit budget: the count assertion above already absorbed the
    // gated-render wait, so by here the table is on screen.
    await expect(
      queueTable.getByRole('columnheader', { name: 'Brand' }),
    ).toBeVisible();
    await expect(
      queueTable.getByRole('columnheader', { name: 'Actions' }),
    ).toBeVisible();
    await expect(adminPage.getByText('Filter by risk')).toHaveCount(0);
    await expect(adminPage.getByText('Filter by tier')).toHaveCount(0);

    // Scoped to the queue table, not to the document. `tbody tr` alone also
    // matched any row the drawer or a future panel renders, and the countdown
    // below (2 -> 1 -> 0) reads as correct only because the seeded brand name
    // carries a timestamp — the scoping is what makes it correct by
    // construction rather than by luck (DEV-1414).
    const pendingRows = queueTable
      .locator('tbody tr')
      .filter({ hasText: brandName });
    await expect(pendingRows).toHaveCount(2, { timeout: BUDGET.GATED_UI });
    await expect(pendingRows.first()).toContainText('Phone number');
    await expect(pendingRows.first().getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
    await expect(pendingRows.first().getByRole('button', { name: 'Dismiss' })).toBeVisible();

    await pendingRows.first().getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(pendingRows).toHaveCount(1, { timeout: BUDGET.GATED_UI });
    await pendingRows.first().getByRole('button', { name: 'Dismiss' }).click();
    await expect(pendingRows).toHaveCount(0, { timeout: BUDGET.GATED_UI });

    const { data: reviewedFlags, error: reviewedFlagsError } = await supabase
      .from('moderation_flags')
      .select('id, status')
      .in('id', [ownerBlockedFlagId, adminBlockedFlagId]);
    expect(reviewedFlagsError).toBeNull();
    expect(new Set(reviewedFlags?.map((flag) => flag.id))).toEqual(
      new Set([ownerBlockedFlagId, adminBlockedFlagId]),
    );
    expect(reviewedFlags?.map((flag) => flag.status).sort()).toEqual([
      'dismissed',
      'reviewed',
    ]);
  });
});
