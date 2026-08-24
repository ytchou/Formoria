import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

import { BUDGET } from '../budgets';
import { e2eBrandImageKey } from '../helpers/image-refs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe.configure({ mode: 'serial' });

// Suite-level gate (DEV-1261). It used to guard the OWNER edit wizard at
// /dashboard/brands/<slug>/edit, which 404s while the flag is off. Declared at
// file scope so it runs before the seeding beforeAll below. Probes the running
// app, never app_settings.
//
// DEV-1570 (PR 3) deleted that wizard, so the two owner-wizard journeys were
// removed from this file rather than left to 404 mid-`serial` and abort the
// admin coverage below. The gate stays because this suite's owner seeding and
// the claim flow around it go with PR 4, and because the three-way skip ledger
// (this callsite, scripts/e2e-owner-skip-registry.ts,
// scripts/e2e-expected-skips.json) is pinned as one unit.
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
    // Bucket keys, not URLs (DEV-1551): the bucket is private.
    const heroKey = e2eBrandImageKey(brandSlug, 'hero.webp');
    const productKey = e2eBrandImageKey(brandSlug, 'product.webp');

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .insert({
        name: brandName,
        slug: brandSlug,
        romanized_name: `E2E Moderation Flow ${timestamp}`,
        status: 'approved',
        approved_at: new Date().toISOString(),
        category: 'home',
        // Slug, not the zh-TW label: this writes straight into `brands`, so it
        // bypasses every conversion path. `brands.subcategories` has no CHECK
        // constraint, so a label would insert cleanly and then match no facet,
        // no L2 page and no `?sub=`. `餐具` is a `tableware` alias.
        subcategories: ['tableware'],
        founding_year: 2020,
        description: cleanDescription,
        hero_image_storage_path: heroKey,
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
        storage_path: heroKey,
        source_url: heroKey,
        source: 'legacy',
        status: 'active',
        sort_order: 0,
      },
      {
        brand_id: brandId,
        storage_path: productKey,
        source_url: productKey,
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
    expect(brand?.description).toBe(cleanDescription);

    const { data: pendingFlags, error: pendingFlagsError } = await supabase
      .from('moderation_flags')
      .select('id, field_name, flag_reason, status')
      .eq('brand_id', brandId)
      .eq('status', 'pending');
    expect(pendingFlagsError).toBeNull();
    expect(pendingFlags).toHaveLength(1);
    const adminFlag = pendingFlags?.at(0);
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
    // below (1 -> 0) reads as correct only because the seeded brand name
    // carries a timestamp — the scoping is what makes it correct by
    // construction rather than by luck (DEV-1414).
    //
    // One row, not two: the second flag came from the owner edit wizard, which
    // DEV-1570 deleted. `Dismiss` is asserted as rendered; its click path goes
    // with the claim flow in PR 4.
    const pendingRows = queueTable
      .locator('tbody tr')
      .filter({ hasText: brandName });
    await expect(pendingRows).toHaveCount(1, { timeout: BUDGET.GATED_UI });
    await expect(pendingRows.first()).toContainText('Phone number');
    await expect(pendingRows.first().getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
    await expect(pendingRows.first().getByRole('button', { name: 'Dismiss' })).toBeVisible();

    await pendingRows.first().getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(pendingRows).toHaveCount(0, { timeout: BUDGET.GATED_UI });

    const { data: reviewedFlags, error: reviewedFlagsError } = await supabase
      .from('moderation_flags')
      .select('id, status')
      .in('id', [adminBlockedFlagId]);
    expect(reviewedFlagsError).toBeNull();
    expect(reviewedFlags?.map((flag) => flag.id)).toEqual([adminBlockedFlagId]);
    expect(reviewedFlags?.map((flag) => flag.status)).toEqual(['reviewed']);
  });
});
