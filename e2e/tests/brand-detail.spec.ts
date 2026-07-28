import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';
import { load } from 'cheerio';
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

  test('tab nav click scrolls to correct section', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // The seeded brand has social links — the tab nav must include a "社群平台" link
    const nav = page.getByRole('navigation', { name: '本頁導覽' });
    await nav.getByRole('link', { name: '社群平台' }).click();

    // After the smooth-scroll the social section heading must be visible in the viewport
    await expect(
      page.getByRole('heading', { name: '社群平台', level: 2 })
    ).toBeInViewport({ timeout: 5_000 });
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

test.describe('Brand detail — historical slugs', () => {
  let approved: SeededBrand;
  let hidden: SeededBrand;
  let approvedOldSlug: string;
  let hiddenOldSlug: string;

  test.beforeAll(async ({}, workerInfo) => {
    approved = await seedBrand({
      name: 'redirect-approved',
      status: 'approved',
      workerIndex: workerInfo.workerIndex,
    });
    hidden = await seedBrand({
      name: 'redirect-hidden',
      status: 'hidden',
      workerIndex: workerInfo.workerIndex,
    });
    approvedOldSlug = `${approved.slug}-old`;
    hiddenOldSlug = `${hidden.slug}-old`;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error: descriptionError } = await supabase
      .from('brands')
      .update({
        description: '這是經過驗證的台灣品牌。',
        description_en: 'This is a verified Taiwanese brand.',
        blurb_en: 'Independent design and careful local production.',
      })
      .eq('id', approved.brand.id);
    if (descriptionError) {
      throw new Error(`Failed to seed localized brand copy: ${descriptionError.message}`);
    }

    const { error: redirectError } = await supabase
      .from('brand_slug_redirects')
      .insert([
        { old_slug: approvedOldSlug, new_slug: approved.slug },
        { old_slug: hiddenOldSlug, new_slug: hidden.slug },
      ]);
    if (redirectError) {
      throw new Error(`Failed to seed brand redirects: ${redirectError.message}`);
    }
  });

  test.afterAll(async () => {
    await approved.cleanup();
    await hidden.cleanup();
  });

  test('approved historical slugs redirect once to localized self-canonical pages', async ({
    request,
  }) => {
    const cases = [
      { source: `/brands/${approvedOldSlug}`, target: `/brands/${approved.slug}` },
      { source: `/en/brands/${approvedOldSlug}`, target: `/en/brands/${approved.slug}` },
    ];

    for (const { source, target } of cases) {
      const redirectResponse = await request.get(source, {
        maxRedirects: 0,
        headers: { 'user-agent': 'Googlebot' },
      });
      expect(redirectResponse.status()).toBe(308);
      expect(redirectResponse.headers().location).toBe(target);

      const targetResponse = await request.get(target, {
        maxRedirects: 0,
        headers: { 'user-agent': 'Googlebot' },
      });
      expect(targetResponse.status()).toBe(200);
      const $ = load(await targetResponse.text());
      const canonical = $('link[rel="canonical"]').attr('href');
      expect(new URL(canonical!).pathname).toBe(target);
      expect($('link[rel="alternate"][hreflang="zh-TW"]').length).toBe(1);
      expect($('link[rel="alternate"][hreflang="en"]').length).toBe(1);
    }
  });

  test('historical slugs targeting hidden brands return direct 404 responses', async ({
    request,
  }) => {
    for (const source of [`/brands/${hiddenOldSlug}`, `/en/brands/${hiddenOldSlug}`]) {
      const response = await request.get(source, {
        maxRedirects: 0,
        headers: { 'user-agent': 'Googlebot' },
      });
      expect(response.status()).toBe(404);
      expect(response.headers().location).toBeUndefined();
    }
  });
});

test.describe('Brand detail — public locations and retail channels', () => {
  let seeded: SeededBrand;

  const confirmedStoreName = '[E2E-TEST] Brand direct store';
  const confirmedStoreAddress = '台北市信義區信義路五段 7 號';
  const confirmedOnlineName = '[E2E-TEST] Brand online channel';
  const anonymousChannelName = '[E2E-TEST] Anonymous confirmation channel';
  const signedInChannelName = '[E2E-TEST] Signed-in confirmation channel';
  const submittedChannelName = '[E2E-TEST] Submitted community channel';
  const confirmedStoreUrl = 'https://example.com/e2e-brand-store';
  const submittedChannelUrl = 'https://example.com/e2e-submitted-channel';

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: 'mixed-channels',
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

    const { data: usersData, error: usersError } =
      await serviceClient.auth.admin.listUsers();
    if (usersError) {
      throw new Error(`Failed to list E2E users: ${usersError.message}`);
    }
    const confirmationUser = usersData.users.find(
      (user) => user.email === process.env.E2E_ADMIN_EMAIL,
    );
    if (!confirmationUser) {
      throw new Error('E2E admin user not found for channel confirmation seed');
    }

    const channelRows = [
      {
        brand_id: seeded.brand.id,
        name: confirmedStoreName,
        normalized_name: 'e2e-brand-direct-store',
        channel_type: 'offline',
        category_label: '品牌直營',
        region_label: '臺北市',
        address: confirmedStoreAddress,
        url: confirmedStoreUrl,
        source: 'owner',
        owner_status: 'confirmed',
      },
      {
        brand_id: seeded.brand.id,
        name: confirmedOnlineName,
        normalized_name: 'e2e-brand-online-channel',
        channel_type: 'online',
        category_label: '選品店',
        region_label: null,
        address: null,
        url: null,
        source: 'owner',
        owner_status: 'confirmed',
      },
      {
        brand_id: seeded.brand.id,
        name: anonymousChannelName,
        normalized_name: 'e2e-anonymous-confirmation-channel',
        channel_type: 'offline',
        category_label: '選品店',
        region_label: '臺中市',
        address: null,
        url: null,
        source: 'community',
        owner_status: 'none',
      },
      {
        brand_id: seeded.brand.id,
        name: signedInChannelName,
        normalized_name: 'e2e-signed-in-confirmation-channel',
        channel_type: 'offline',
        category_label: '選品店',
        region_label: '新北市',
        address: null,
        url: null,
        source: 'community',
        owner_status: 'none',
      },
    ];

    const { data: channels, error: channelsError } = await serviceClient
      .from('brand_channels')
      .insert(channelRows)
      .select('id, name');
    if (channelsError || !channels) {
      throw new Error(
        `Failed to seed brand channels: ${channelsError?.message ?? 'missing rows'}`,
      );
    }

    const channelIds = new Map(channels.map((channel) => [channel.name, channel.id]));
    const getChannelId = (name: string): string => {
      const id = channelIds.get(name);
      if (!id) throw new Error(`Seeded channel not found: ${name}`);
      return id;
    };
    const { error: confirmationsError } = await serviceClient
      .from('brand_channel_confirmations')
      .insert([
        { channel_id: getChannelId(confirmedStoreName), user_id: confirmationUser.id },
        { channel_id: getChannelId(confirmedOnlineName), user_id: confirmationUser.id },
      ]);
    if (confirmationsError) {
      throw new Error(
        `Failed to seed channel confirmations: ${confirmationsError.message}`,
      );
    }
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test('group headings render with correct counts', async ({ page }) => {
    test.setTimeout(90_000);

    await expect(async () => {
      await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        seeded.brand.name,
        { timeout: 10_000 },
      );
      await expect(
        page.getByRole('heading', { name: '官方通路 (2)', level: 3 }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          name: '連鎖與其他門市 (2)',
          level: 3,
        }),
      ).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
  });

  test('category badges render', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('品牌直營', { exact: true })).toBeVisible();
    await expect(page.getByText('選品店', { exact: true }).first()).toBeVisible();
  });

  test('Google Maps link renders when an address is present', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('link', { name: '臺北市', exact: true })).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/search\//,
    );
  });

  test('external link renders for channels with a URL', async ({ page }) => {
    await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('link', { name: '查看店家資訊', exact: true })).toHaveAttribute(
      'href',
      confirmedStoreUrl,
    );
  });

  test('anonymous confirm shows a sign-in prompt', async ({ anonPage }) => {
    await anonPage.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });

    const channelChip = anonPage
      .locator('[data-channel-chip]')
      .filter({ hasText: anonymousChannelName });
    await channelChip
      .getByRole('button', {
        name: `我確認${anonymousChannelName}有販售`,
        exact: true,
      })
      .click();

    const chipGroup = anonPage
      .locator('[data-channel-chip-group]')
      .filter({ hasText: anonymousChannelName });
    await expect(chipGroup.getByText('登入後即可確認')).toBeVisible();
    await expect(chipGroup.getByRole('link', { name: '登入', exact: true })).toHaveAttribute(
      'href',
      /\/auth\/sign-in\?next=/,
    );
  });

  test('signed-in confirm increments the confirmation count', async ({ userPage }) => {
    test.setTimeout(90_000);
    await userPage.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });

    const channelChip = userPage
      .locator('[data-channel-chip]')
      .filter({ hasText: signedInChannelName });
    await expect(channelChip.getByText('0/3 人確認')).toBeVisible();
    await channelChip
      .getByRole('button', {
        name: `我確認${signedInChannelName}有販售`,
        exact: true,
      })
      .click();
    await expect(channelChip.getByText('1/3 人確認')).toBeVisible();

    // That count is optimistic: Next.js serializes server actions into one global
    // queue, so the confirm can still be waiting behind the mount-time actions.
    // Reloading now would tear the page down before the write is ever dispatched.
    await expect(channelChip).not.toHaveAttribute('data-confirm-pending', '', {
      timeout: 15_000,
    });

    // The page is `force-static` with `revalidate = 3600`, so on-demand
    // revalidation is stale-while-revalidate: the first request after the
    // mutation can still be served from the old cache entry while the
    // regeneration runs. Retry the reload rather than assuming the write is
    // readable on the very next request. Same pattern as the submitted-channel
    // test below.
    await expect(async () => {
      await userPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        userPage
          .locator('[data-channel-chip]')
          .filter({ hasText: signedInChannelName })
          .getByText('1/3 人確認'),
      ).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
  });

  test('submitted channel appears in the online group', async ({ userPage }) => {
    test.setTimeout(90_000);
    await userPage.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });

    // The trigger ships in the server-rendered HTML, so a missing one is a real
    // regression rather than a timing problem. Assert it before the retry loop so
    // that case does not surface as an opaque "predicate timed out" on the dialog.
    const trigger = userPage.getByRole('button', { name: '提供販售資訊', exact: true });
    await expect(trigger).toBeVisible();

    // The brand page is statically served and hydrates afterwards, so a click that
    // lands too early is a silent no-op and every later step then times out waiting
    // on a dialog that was never opened. Retry the idempotent open instead of
    // sleeping on a guessed hydration delay — same pattern as openCategoryDialog in
    // brand-corrections.spec.ts.
    const dialog = userPage.getByRole('dialog', { name: '提供販售資訊' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await trigger.click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
    await dialog.getByRole('textbox', { name: '通路名稱' }).fill(submittedChannelName);
    await dialog.getByRole('combobox', { name: '通路類型' }).selectOption('online');
    await dialog.getByRole('combobox', { name: '通路分類' }).selectOption('other');
    await dialog.getByRole('combobox', { name: '地區' }).selectOption('taipei');
    await dialog.getByRole('textbox', { name: '網址' }).fill(submittedChannelUrl);
    await dialog.getByRole('button', { name: '送出', exact: true }).click();
    // The submit still queues behind the like-button action, so give it 30s.
    await expect(dialog.getByText('感謝您提供的資訊！')).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: '關閉', exact: true }).click();

    await expect(async () => {
      await userPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        userPage.getByRole('heading', {
          name: '線上通路 (1)',
          level: 3,
        }),
      ).toBeVisible();
      await expect(
        userPage.locator('[data-channel-chip]').filter({ hasText: submittedChannelName }),
      ).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
  });
});
