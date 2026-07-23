import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedBrand, SeededBrand } from "../helpers/seed";

test.describe('Brand detail deep', () => {
  let brandHref: string;
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "detail",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
      withOwner: true,
    });
  });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/brands', { waitUntil: 'domcontentloaded' });
    const cards = page.locator('main a[aria-label]');
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 });
    const count = await cards.count();
    let href: string | null = null;
    for (let i = 0; i < count; i++) {
      const h = await cards.nth(i).getAttribute('href');
      if (h && /^\/brands\/[\w-]+$/.test(h)) {
        href = h;
        break;
      }
    }
    await page.close();
    brandHref = href ?? `/brands/${seeded.slug}`;
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test('all sections render without error', async ({ page }) => {
    await page.goto(brandHref);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    // No error boundaries or 404
    await expect(page.getByText(/something went wrong|not found|error|發生錯誤/i)).not.toBeVisible();
  });

  test('brand detail shows social and purchase links in two separate sections', async ({ page }) => {
    // Use a known brand that has links data to verify two-section structure.
    // Fall back to the dynamically resolved href if the known brand is absent.
    await page.goto(`/brands/${seeded.slug}`);

    // Verify the social section heading is visible
    await expect(
      page.getByRole('heading', { name: '社群平台', level: 2 })
    ).toBeVisible({ timeout: 10_000 });

    // Verify the purchase section heading is visible
    await expect(
      page.getByRole('heading', { name: '購買管道', level: 2 })
    ).toBeVisible({ timeout: 10_000 });

    // Both sections must appear on the same page — confirming structural separation
    const socialSection = page.getByRole('heading', { name: '社群平台', level: 2 });
    const purchaseSection = page.getByRole('heading', { name: '購買管道', level: 2 });
    await expect(socialSection).toBeVisible();
    await expect(purchaseSection).toBeVisible();
  });

  test('links sections are structurally separate (social before purchase)', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`);

    const socialHeading = page.getByRole('heading', { name: '社群平台', level: 2 });
    const purchaseHeading = page.getByRole('heading', { name: '購買管道', level: 2 });

    await expect(socialHeading).toBeVisible({ timeout: 10_000 });
    await expect(purchaseHeading).toBeVisible();

    // Social section must appear before purchase section in document order
    const socialBox = await socialHeading.boundingBox();
    const purchaseBox = await purchaseHeading.boundingBox();
    expect(socialBox).not.toBeNull();
    expect(purchaseBox).not.toBeNull();
    expect(socialBox!.y).toBeLessThan(purchaseBox!.y);
  });

  test('external links have target="_blank" and rel="noopener"', async ({ page }) => {
    await page.goto(brandHref);
    const externalLinks = page.locator('a[href^="http"]:not([href*="localhost"])');
    const count = await externalLinks.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const link = externalLinks.nth(i);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
  });

  test('SEO meta tags are present', async ({ page }) => {
    await page.goto(brandHref);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle?.length).toBeGreaterThan(0);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length).toBeGreaterThan(0);
  });

  test('JSON-LD structured data is present', async ({ page }) => {
    await page.goto(brandHref);
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    const parsed = JSON.parse(jsonLd || '{}');
    expect(parsed['@type']).toBeTruthy();
  });

  test('canonical URL matches current URL', async ({ page }) => {
    await page.goto(brandHref);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(decodeURIComponent(canonical ?? '')).toContain(decodeURIComponent(brandHref));
  });

  test('FAQ accordion renders on a data-rich brand', async ({ page }) => {
    // Seeded with purchase links and social accounts — FAQ conditions are met
    await page.goto(`/brands/${seeded.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // FAQ section heading is visible (zh-TW default locale — brandFaq.sectionTitle = '常見問題')
    await expect(
      page.getByRole('heading', { name: '常見問題', level: 2 })
    ).toBeVisible({ timeout: 10_000 });

    // At least one accordion trigger (FAQ item) is present and visible
    await expect(
      page.locator('[data-slot="accordion-trigger"]').first()
    ).toBeVisible();
  });
});

test.describe('Brand detail — brand without links', () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    // No withLinks — brand has no social/purchase URLs at all
    seeded = await seedBrand({
      name: 'nolinks',
      status: 'approved',
      workerIndex: workerInfo.workerIndex,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test('no dangling social/purchase section headings when brand has no links', async ({ page }) => {
    test.setTimeout(90_000);

    // ISR pages may serve a stale cache — poll-reload until the seeded brand page renders
    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText('nolinks', {
        timeout: 10_000,
      });
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });

    // With no links seeded, neither section label may dangle without content
    await expect(page.getByRole('heading', { name: '社群平台', level: 2 })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '購買管道', level: 2 })).toHaveCount(0);
  });
});

test.describe('Brand detail — hidden brand', () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: 'hidden-brand',
      status: 'hidden',
      workerIndex: workerInfo.workerIndex,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test('hidden brands are not publicly accessible', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`);

    await expect(page.getByRole('heading', { name: seeded.brand.name })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  });
});

test.describe('Brand detail — public locations and retail channels', () => {
  let seeded: SeededBrand;

  const confirmedStoreName = '[E2E-TEST] Taipei brand store';
  const confirmedStoreAddress = '台北市信義區信義路五段7號';
  const verifiedStoreName = '[E2E-TEST] Evidence-verified brand store';
  const verifiedStoreAddress = '台北市大安區證據路9號';
  const confirmedStockistName = '[E2E-TEST] Taichung stockist';
  const privateLeadName = '[E2E-TEST] Private physical lead';
  const privateLeadAddress = '[E2E-TEST] Private Address 991 No Render Lane';
  const chainName = '[E2E-TEST] Retail chain';
  const retailerUrl = 'https://example.com/e2e-retailer';

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: 'mixed-locations',
      status: 'approved',
      workerIndex: workerInfo.workerIndex,
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase service-role environment is required');
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await serviceClient
      .from('brands')
      .update({
        retail_locations: [
          {
            kind: 'location',
            name: confirmedStoreName,
            relationshipType: 'brand_store',
            address: confirmedStoreAddress,
            latitude: 25.033,
            longitude: 121.5654,
            confirmationStatus: 'owner_confirmed',
          },
          {
            kind: 'location',
            name: verifiedStoreName,
            relationshipType: 'brand_store',
            address: verifiedStoreAddress,
            latitude: 25.026,
            longitude: 121.543,
            verificationStatus: 'verified',
            confirmationStatus: 'unconfirmed',
          },
          {
            kind: 'location',
            name: confirmedStockistName,
            relationshipType: 'stockist',
            address: '台中市西屯區台灣大道三段301號',
            confirmationStatus: 'owner_confirmed',
          },
          {
            kind: 'location',
            name: privateLeadName,
            relationshipType: 'stockist',
            address: privateLeadAddress,
            confirmationStatus: 'unconfirmed',
          },
          {
            kind: 'retail_chain',
            name: chainName,
            retailerUrl,
          },
        ],
      })
      .eq('slug', seeded.slug);

    expect(error).toBeNull();
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test('groups locations safely and supports mobile filter and view controls', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        seeded.brand.name,
        { timeout: 10_000 },
      );
      await expect(page.getByRole('heading', { name: '販售地點 · 4', level: 3 })).toBeVisible();
      await expect(page.getByRole('heading', { name: '連鎖販售通路 · 1', level: 3 })).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });

    await expect(page.getByText('以下地點依公開資訊整理，可能尚未經品牌主確認；前往前請先向品牌或店家確認。')).toBeVisible();
    await expect(page.getByText('各分店販售情況不同；通路連結僅供查詢通路資訊，不代表即時庫存。')).toBeVisible();
    await expect(page.getByText(privateLeadName)).toBeVisible();
    await expect(page.getByText(privateLeadAddress)).toBeVisible();
    await expect(page.getByText(verifiedStoreName)).toBeVisible();
    await expect(page.getByText(verifiedStoreAddress)).toBeVisible();
    await expect(page.getByRole('link', { name: '查看通路資訊' })).toHaveAttribute(
      'href',
      retailerUrl,
    );

    const map = page.getByRole('region', {
      name: `${seeded.brand.name} 販售地點地圖`,
    });
    await expect(map).toBeVisible({ timeout: 10_000 });

    const locationHeading = page.getByRole('heading', {
      name: '販售地點 · 4',
      level: 3,
    });
    const locationGroup = locationHeading.locator('..').locator('..');
    const allFilter = locationGroup.getByRole('button', { name: '全部 4' });
    const brandStoreFilter = locationGroup.getByRole('button', {
      name: '品牌門市 2',
    });
    const otherSalesFilter = locationGroup.getByRole('button', {
      name: '其他販售通路 2',
    });

    await allFilter.focus();
    await page.keyboard.press('Tab');
    await expect(brandStoreFilter).toBeFocused();
    const filterBox = await brandStoreFilter.boundingBox();
    expect(filterBox).not.toBeNull();
    expect(filterBox!.height).toBeGreaterThanOrEqual(48);

    await brandStoreFilter.press('Enter');
    await expect(brandStoreFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(locationGroup.getByText(confirmedStoreName)).toBeVisible();
    await expect(locationGroup.getByText(verifiedStoreName)).toBeVisible();
    await expect(locationGroup.getByText(confirmedStockistName)).toHaveCount(0);
    await expect(locationGroup.getByText(privateLeadName)).toHaveCount(0);
    await expect(locationGroup.getByText(chainName)).toHaveCount(0);

    await otherSalesFilter.click();
    await expect(locationGroup.getByText(confirmedStockistName)).toBeVisible();
    await expect(locationGroup.getByText(privateLeadName)).toBeVisible();
    await expect(locationGroup.getByText(confirmedStoreName)).toHaveCount(0);
    await expect(locationGroup.getByText(verifiedStoreName)).toHaveCount(0);
    await expect(map).toHaveCount(0);

    await allFilter.click();
    const mapView = locationGroup.getByRole('button', { name: '地圖' });
    await expect(mapView).toBeVisible();
    await mapView.click();
    await expect(map).toBeVisible();

    const viewAll = locationGroup.getByRole('button', { name: '查看全部' });
    await viewAll.click();
    await expect(map).toHaveCount(0);
    await expect(locationGroup.getByText(confirmedStoreName)).toBeVisible();
    await expect(locationGroup.getByText(verifiedStoreName)).toBeVisible();
    await expect(locationGroup.getByText(confirmedStockistName)).toBeVisible();
    await expect(locationGroup.getByText(privateLeadName)).toBeVisible();
  });
});

test('brand with name-only best-effort locations does not render a map', async ({ page }) => {
  await page.goto('/brands/littdlework', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: '永康旗艦店' })).toBeVisible();
  await expect(page.getByRole('region', { name: /販售地點地圖|stockist map/i })).toHaveCount(0);
});
