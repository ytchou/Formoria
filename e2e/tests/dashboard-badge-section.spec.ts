import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Dashboard — badge embed and share card section
 *
 * Journey: Authenticated brand owner sees badge embed section and share card
 * on the dashboard /dashboard?brand=<slug>#badge for approved brands.
 * For hidden brands the section is entirely absent.
 *
 * Actor: authenticated owner via `userPage` fixture.
 * Seeds: one approved brand + one hidden brand, both owned by the e2e user.
 * Cleanup: afterAll cascade-deletes both brands.
 */
test.describe('Dashboard — badge and share card section', () => {
   
  let supabase: AnySupabaseClient;
  let approvedBrandId: string;
  let approvedBrandSlug: string;
  let approvedBrandName: string;
  let hiddenBrandId: string;
  let hiddenBrandSlug: string;
  let hiddenBrandName: string;

  test.beforeAll(async ({ request }, workerInfo) => {
    // PREVIEW_MODE guard — probe before seeding to avoid wasted work
    const probe = await request.get('/brands');
    if (probe.status() === 503) return;

    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);

    const ts = Date.now();
    const wi = workerInfo.workerIndex;
    approvedBrandSlug = `e2e-badge-approved-${ts}-${wi}`;
    hiddenBrandSlug = `e2e-badge-hidden-${ts}-${wi}`;
    approvedBrandName = `[E2E-TEST] Badge Approved ${ts}`;
    hiddenBrandName = `[E2E-TEST] Badge Hidden ${ts}`;

    // Seed approved brand
    const { data: approvedData, error: approvedErr } = await supabase
      .from('brands')
      .insert({
        name: approvedBrandName,
        slug: approvedBrandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] badge section approved brand',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (approvedErr || !approvedData) throw new Error(`seed approved brand: ${approvedErr?.message}`);
    approvedBrandId = approvedData.id as string;
    await supabase.from('brand_owners').insert({ user_id: testUser.id, brand_id: approvedBrandId });

    // Seed hidden brand (negative case: badge section must not render)
    const { data: hiddenData, error: hiddenErr } = await supabase
      .from('brands')
      .insert({
        name: hiddenBrandName,
        slug: hiddenBrandSlug,
        status: 'hidden',
        product_type: 'crafts',
        description: '[E2E-TEST] badge section hidden brand',
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (hiddenErr || !hiddenData) throw new Error(`seed hidden brand: ${hiddenErr?.message}`);
    hiddenBrandId = hiddenData.id as string;
    await supabase.from('brand_owners').insert({ user_id: testUser.id, brand_id: hiddenBrandId });
  });

  test.afterAll(async () => {
    if (!supabase) return;
    // ON DELETE CASCADE handles brand_owners — single brands delete is sufficient.
    if (approvedBrandId) await supabase.from('brands').delete().eq('id', approvedBrandId);
    if (hiddenBrandId) await supabase.from('brands').delete().eq('id', hiddenBrandId);
  });

  test('badge section renders with badge image, share card preview, and download link for approved brand', async ({ userPage }) => {
    test.setTimeout(120_000);
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await userPage.goto(`/dashboard?brand=${approvedBrandSlug}#badge`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // Confirm dashboard loaded with the seeded brand selected (heading pattern from dashboard-tabs)
    await expect(userPage.getByRole('heading').filter({ hasText: approvedBrandName }).first()).toBeVisible({ timeout: 60_000 });

    // Badge section wrapper (id="badge") must be in the page
    const badgeSection = userPage.locator('#badge');
    await expect(badgeSection).toBeVisible({ timeout: 10_000 });

    // Badge SVG image loads — naturalWidth > 0 confirms the resource was served
    const badgeImg = userPage.getByRole('img', { name: 'Featured on Formoria' });
    await expect(badgeImg).toBeVisible({ timeout: 5_000 });
    const naturalWidth = await badgeImg.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);

    // Share card preview img — src must point to the API route with a cache-buster v= param
    const shareCardPreview = userPage.locator('[data-testid="share-card-preview"]');
    await expect(shareCardPreview).toBeVisible({ timeout: 5_000 });
    const previewSrc = await shareCardPreview.getAttribute('src');
    expect(previewSrc).toContain(`/api/share-card/${approvedBrandSlug}`);
    expect(previewSrc).toContain('v=');

    // Download link href must contain download=1
    const downloadLink = userPage.locator('[data-testid="card-download-link"]');
    await expect(downloadLink).toBeVisible({ timeout: 5_000 });
    const downloadHref = await downloadLink.getAttribute('href');
    expect(downloadHref).toContain('download=1');
  });

  test('badge copy button writes embed snippet with utm_source=badge and brand slug to clipboard', async ({ userPage }) => {
    test.setTimeout(120_000);
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await userPage.goto(`/dashboard?brand=${approvedBrandSlug}#badge`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await expect(userPage.getByRole('heading').filter({ hasText: approvedBrandName }).first()).toBeVisible({ timeout: 60_000 });

    // Grant clipboard permissions — Desktop Chrome (deep project) supports this
    await userPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const copyBtn = userPage.locator('[data-testid="badge-copy-button"]');
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });
    await copyBtn.click();

    const clipboardText = await userPage.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('utm_source=badge');
    expect(clipboardText).toContain(approvedBrandSlug);
  });

  test('badge section is absent for hidden brand', async ({ userPage }) => {
    test.setTimeout(120_000);
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const resp = await userPage.goto(`/dashboard?brand=${hiddenBrandSlug}`, { timeout: 60_000 });
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return; }

    // Dashboard still loads with the hidden brand selected (owned brands are selectable)
    await expect(userPage.getByRole('heading').filter({ hasText: hiddenBrandName }).first()).toBeVisible({ timeout: 60_000 });

    // None of the badge-section elements must be in the DOM for hidden brands
    await expect(userPage.locator('#badge')).toHaveCount(0);
    await expect(userPage.locator('[data-testid="badge-copy-button"]')).toHaveCount(0);
    await expect(userPage.locator('[data-testid="share-card-preview"]')).toHaveCount(0);
    await expect(userPage.locator('[data-testid="card-download-link"]')).toHaveCount(0);
  });
});
