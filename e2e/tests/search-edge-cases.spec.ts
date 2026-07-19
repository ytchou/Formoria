import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Route,
} from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

type ApiSearchResult = {
  id: string;
  name: string;
  slug: string;
  category: string;
};

test.describe.serial('Public brand search edge cases', () => {
  test.skip(process.env.PREVIEW_MODE === 'true', 'PREVIEW_MODE active — skipping DB-write test');

  let supabase: AnySupabaseClient | undefined;
  let seededIds: string[] = [];
  let exactName: string;
  let exactQuery: string;
  let exactSlug: string;
  let descriptionName: string;
  let descriptionSlug: string;
  let bilingualName: string;
  let bilingualSlug: string;
  let hiddenSlug: string;
  let englishToken: string;

  async function apiSearch(
    request: APIRequestContext,
    query: string,
  ): Promise<ApiSearchResult[]> {
    const response = await request.get('/api/search', {
      params: { q: query, limit: '10' },
    });
    expect(response.status(), `search API status for ${JSON.stringify(query)}`).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      results: expect.any(Array),
    });
    return body.results as ApiSearchResult[];
  }

  test.beforeAll(async ({ request }) => {
    const probe = await request.get('/brands');
    if (probe.status() === 503) return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Search E2E requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    supabase = createClient(supabaseUrl, serviceRoleKey);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    englishToken = `prismora${suffix}`;
    exactQuery = `棱 鏡茶坊 ${suffix}`;
    exactName = `[E2E-TEST] ${exactQuery}`;
    exactSlug = `e2e-search-exact-${suffix}`;
    descriptionName = `[E2E-TEST] 描述命中 ${suffix}`;
    descriptionSlug = `e2e-search-description-${suffix}`;
    bilingualName = `[E2E-TEST] 雲峰器物 ${suffix}`;
    bilingualSlug = `e2e-search-bilingual-${suffix}`;
    hiddenSlug = `e2e-search-hidden-${suffix}`;

    const { data, error } = await supabase
      .from('brands')
      .insert([
        {
          name: exactName,
          slug: exactSlug,
          status: 'approved',
          product_type: 'crafts',
          description: `[E2E-TEST] Exact-name search probe ${suffix}.`,
          blurb_en: `Exact prism teaware ${suffix}.`,
          retail_locations: [],
          is_demo: false,
        },
        {
          name: descriptionName,
          slug: descriptionSlug,
          status: 'approved',
          product_type: 'crafts',
          description: `[E2E-TEST] Description-only phrase ${exactQuery}.`,
          retail_locations: [],
          is_demo: false,
        },
        {
          name: bilingualName,
          slug: bilingualSlug,
          status: 'approved',
          product_type: 'crafts',
          description: `[E2E-TEST] Bilingual search probe ${suffix}.`,
          blurb_en: `${englishToken} Aurora Copper Vessel.`,
          product_tags_en: [englishToken, 'teaware'],
          retail_locations: [],
          is_demo: false,
        },
        {
          name: `[E2E-TEST] ${exactQuery} 隱藏`,
          slug: hiddenSlug,
          status: 'hidden',
          product_type: 'crafts',
          description: `[E2E-TEST] Hidden search probe ${suffix}.`,
          blurb_en: `${englishToken} hidden result.`,
          retail_locations: [],
          is_demo: false,
        },
      ])
      .select('id');

    if (error || !data || data.length !== 4) {
      throw new Error(`Search E2E seed failed: ${error?.message ?? 'unexpected row count'}`);
    }
    seededIds = data.map((row) => row.id as string);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    for (const id of seededIds) {
      const { error } = await supabase.from('brands').delete().eq('id', id);
      if (error) console.warn(`[e2e-cleanup] search brand ${id}: ${error.message}`);
    }
  });

  test('seeded exact result outranks description-only and hidden brands stay excluded', async ({
    page,
    request,
  }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const autocomplete = await apiSearch(request, exactQuery);
    const exactIndex = autocomplete.findIndex((result) => result.slug === exactSlug);
    const descriptionIndex = autocomplete.findIndex((result) => result.slug === descriptionSlug);
    expect(exactIndex, 'seeded exact result proves the RPC is available').toBeGreaterThanOrEqual(0);
    expect(descriptionIndex).toBeGreaterThan(exactIndex);
    expect(autocomplete.some((result) => result.slug === hiddenSlug)).toBe(false);

    await page.goto(`/brands?search=${encodeURIComponent(exactQuery)}`);
    const cardHeadings = page.locator('main [role="list"] [role="listitem"] h3');
    await expect(cardHeadings.filter({ hasText: exactName })).toBeVisible({ timeout: 15_000 });
    const names = await cardHeadings.allTextContents();
    expect(names.indexOf(exactName)).toBeGreaterThanOrEqual(0);
    expect(names.indexOf(descriptionName)).toBeGreaterThan(names.indexOf(exactName));
    await expect(page.locator(`a[href$="/${hiddenSlug}"]`)).toHaveCount(0);
  });

  test('CJK tokens, English bilingual fields, prefix, typo, case, and punctuation find the seed', async ({
    page,
    request,
  }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const typo = `${englishToken.slice(0, 2)}${englishToken[3]}${englishToken[2]}${englishToken.slice(4)}`;
    const autocompleteCases = [
      { query: `棱 鏡`, slug: exactSlug },
      { query: englishToken, slug: bilingualSlug },
      { query: englishToken.toUpperCase(), slug: bilingualSlug },
      { query: englishToken.slice(0, -3), slug: bilingualSlug },
      { query: `${englishToken}!`, slug: bilingualSlug },
    ];

    for (const { query, slug } of autocompleteCases) {
      const results = await apiSearch(request, query);
      expect(
        results.some((result) => result.slug === slug),
        `seeded slug ${slug} missing for ${JSON.stringify(query)}`,
      ).toBe(true);
    }

    // Typo tolerance uses trigram — only available via full directory search (prefix_mode=false)
    await page.goto(`/en/brands?search=${encodeURIComponent(typo)}`);
    await expect(page.getByRole('link', { name: bilingualName })).toBeVisible({ timeout: 15_000 });

    await page.goto(`/en/brands?search=${encodeURIComponent(englishToken)}`);
    await expect(page).toHaveURL(/\/en\/brands\?search=/);
    await expect(page.getByRole('link', { name: bilingualName })).toBeVisible({ timeout: 15_000 });
  });

  test('landing, desktop nav, localized directory, and mobile menu reach search', async ({ page }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await page.goto('/');
    const heroSearch = page.locator('main form[role="search"] input[role="searchbox"]');
    await heroSearch.fill(exactQuery);
    await heroSearch.press('Enter');
    await expect(page).toHaveURL((url) =>
      url.pathname === '/brands' && url.searchParams.get('search') === exactQuery,
    );
    await expect(page.getByRole('link', { name: exactName })).toBeVisible({ timeout: 15_000 });

    await page.goto('/about');
    const desktopNavSearch = page.locator('header form[role="search"] input[role="searchbox"]:visible');
    await desktopNavSearch.fill(englishToken);
    await expect(page.getByRole('option', { name: bilingualName })).toBeVisible();
    await desktopNavSearch.press('ArrowDown');
    await desktopNavSearch.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/brands/${bilingualSlug}$`));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const mobileSearch = page.locator('[role="dialog"] form[role="search"] input[role="searchbox"]');
    await mobileSearch.fill(englishToken);
    await mobileSearch.press('Enter');
    await expect(page).toHaveURL((url) =>
      url.pathname === '/en/brands' && url.searchParams.get('search') === englishToken,
    );
    await expect(page.getByRole('link', { name: bilingualName })).toBeVisible({ timeout: 15_000 });
  });

  test('directory sidebar and nav stay synchronized while unrelated filters survive', async ({ page }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await page.goto('/brands?category=crafts&sort=name&page=2');
    const sidebarSearch = page.locator(
      'main form[aria-label="依品牌名稱篩選"] input[role="searchbox"]',
    );
    const navSearch = page.locator('header form[role="search"] input[role="searchbox"]:visible');
    await sidebarSearch.fill(exactQuery);

    await expect(page).toHaveURL((url) =>
      url.searchParams.get('search') === exactQuery
      && url.searchParams.get('category') === 'crafts'
      && url.searchParams.get('sort') === 'name'
      && !url.searchParams.has('page'),
    );
    await expect(navSearch).toHaveValue(exactQuery);
    await expect(sidebarSearch).toHaveValue(exactQuery);

    await sidebarSearch.locator('..').getByRole('button', { name: '清除搜尋' }).click();
    await expect(page).toHaveURL((url) =>
      !url.searchParams.has('search')
      && url.searchParams.get('category') === 'crafts'
      && url.searchParams.get('sort') === 'name',
    );
    await expect(navSearch).toHaveValue('');
  });

  test('an out-of-order autocomplete response cannot replace the latest dropdown', async ({ page }) => {
    let slowRoute: Route | undefined;
    let markSlowSeen!: () => void;
    const slowSeen = new Promise<void>((resolve) => {
      markSlowSeen = resolve;
    });
    const slowQuery = `slow-${randomUUID()}`;
    const fastQuery = `fast-${randomUUID()}`;

    await page.route('**/api/search**', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q');
      if (query === slowQuery) {
        slowRoute = route;
        markSlowSeen();
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ id: 'latest', name: 'Latest Result', slug: 'latest', category: 'crafts' }],
        }),
      });
    });

    await page.goto('/about');
    const search = page.locator('header form[role="search"] input[role="searchbox"]:visible');
    await search.fill(slowQuery);
    await slowSeen;
    await search.fill(fastQuery);
    await expect(page.getByRole('option', { name: /Latest Result/ })).toBeVisible();

    const routeToRelease = slowRoute;
    if (!routeToRelease) throw new Error('Slow autocomplete request was not captured');
    await routeToRelease.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 'stale', name: 'Stale Result', slug: 'stale', category: 'crafts' }],
      }),
    });

    await expect(page.getByRole('option', { name: /Latest Result/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Stale Result/ })).toHaveCount(0);
  });

  test('no-result state safely renders the query and offers recovery after a seeded-positive preflight', async ({
    page,
    request,
  }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    const positive = await apiSearch(request, exactQuery);
    expect(positive.some((result) => result.slug === exactSlug)).toBe(true);

    const missingQuery = `<img src=x onerror=alert(1)>-${randomUUID()}`;
    await page.goto(`/brands?search=${encodeURIComponent(missingQuery)}`);
    const emptyState = page.locator('[data-empty]');
    await expect(emptyState).toBeVisible({ timeout: 15_000 });
    await expect(emptyState.getByRole('heading', { name: '找不到符合的品牌' })).toBeVisible();
    await expect(emptyState.getByRole('status')).toContainText(missingQuery);
    await expect(emptyState.locator('img[src="x"]')).toHaveCount(0);
    await expect(emptyState.getByRole('link', { name: '清除全部' })).toHaveAttribute('href', '/brands');
    await expect(emptyState.getByRole('heading', { name: '你可能想找' })).toBeVisible();
    await expect(emptyState.getByRole('link', { name: '查看全部' })).toBeVisible();
  });
});
