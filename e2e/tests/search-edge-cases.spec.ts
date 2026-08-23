import { BUDGET } from '../budgets';
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
  let sortQuery: string;
  let sortFirstName: string;
  let sortLastName: string;

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
    sortQuery = `sortprobe${suffix}`;
    sortFirstName = `[E2E-TEST] Aster ${sortQuery}`;
    sortLastName = `[E2E-TEST] Zenith ${sortQuery}`;
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
          approved_at: new Date().toISOString(),
          category: 'home',
          description: `[E2E-TEST] Exact-name search probe ${suffix}.`,
          blurb_en: `Exact prism teaware ${suffix}.`,
          is_demo: false,
        },
        {
          name: descriptionName,
          slug: descriptionSlug,
          status: 'approved',
          approved_at: new Date().toISOString(),
          category: 'home',
          description: `[E2E-TEST] Description-only phrase ${exactQuery}.`,
          is_demo: false,
        },
        {
          name: bilingualName,
          slug: bilingualSlug,
          status: 'approved',
          approved_at: new Date().toISOString(),
          category: 'home',
          description: `[E2E-TEST] Bilingual search probe ${suffix}.`,
          blurb_en: `${englishToken} Aurora Copper Vessel.`,
          subcategories_en: [englishToken, 'teaware'],
          is_demo: false,
        },
        {
          name: `[E2E-TEST] ${exactQuery} 隱藏`,
          slug: hiddenSlug,
          status: 'hidden',
          category: 'home',
          description: `[E2E-TEST] Hidden search probe ${suffix}.`,
          blurb_en: `${englishToken} hidden result.`,
          is_demo: false,
        },
        {
          name: sortLastName,
          slug: `e2e-search-sort-last-${suffix}`,
          status: 'approved',
          approved_at: new Date().toISOString(),
          category: 'home',
          description: `[E2E-TEST] A-Z search sort probe ${sortQuery}.`,
          is_demo: false,
        },
        {
          name: sortFirstName,
          slug: `e2e-search-sort-first-${suffix}`,
          status: 'approved',
          approved_at: new Date().toISOString(),
          category: 'home',
          description: `[E2E-TEST] A-Z search sort probe ${sortQuery}.`,
          is_demo: false,
        },
      ])
      .select('id');

    if (error || !data || data.length !== 6) {
      throw new Error(`Search E2E seed failed: ${error?.message ?? 'unexpected row count'}`);
    }
    seededIds = data.map((row) => row.id as string);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    for (const id of seededIds) {
      const { error } = await supabase.from('brands').delete().eq('id', id);
      if (error) throw new Error(`[e2e-cleanup] search brand ${id}: ${error.message}`);
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
    await expect(cardHeadings.filter({ hasText: exactName })).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
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
    await expect(page.getByRole('link', { name: bilingualName })).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    await page.goto(`/en/brands?search=${encodeURIComponent(englishToken)}`);
    await expect(page).toHaveURL(/\/en\/brands\?search=/);
    await expect(page.getByRole('link', { name: bilingualName })).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test('directory, desktop nav, localized directory, and mobile menu reach search', async ({ page }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await page.goto('/brands');
    const directorySearch = page.locator(
      'main form[aria-label="依品牌或產品關鍵字篩選"] input[role="searchbox"]',
    );
    await directorySearch.fill(exactQuery);
    await expect(page).toHaveURL((url) =>
      url.pathname === '/brands' && url.searchParams.get('search') === exactQuery,
    );
    await expect(page.getByRole('link', { name: exactName })).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

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
    await expect(page.getByRole('link', { name: bilingualName })).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test('directory sidebar and nav stay synchronized while unrelated filters survive', async ({ page }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await page.goto('/categories/home?sort=name&page=2');
    const sidebarSearch = page.locator(
      'main form[aria-label="依品牌或產品關鍵字篩選"] input[role="searchbox"]',
    );
    const navSearch = page.locator('header form[role="search"] input[role="searchbox"]:visible');
    await sidebarSearch.fill(exactQuery);

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/categories/home' &&
        url.searchParams.get('search') === exactQuery &&
        url.searchParams.get('sort') === 'name' &&
        !url.searchParams.has('page'),
    );
    await expect(navSearch).toHaveValue(exactQuery);
    await expect(sidebarSearch).toHaveValue(exactQuery);

    await sidebarSearch
      .locator('..')
      .getByRole('button', { name: '清除搜尋' })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/categories/home' &&
        !url.searchParams.has('search') &&
        url.searchParams.get('sort') === 'name',
    );
    await expect(navSearch).toHaveValue('');
  });

  test('selecting A-Z orders the matching cards by their rendered brand names', async ({ page }) => {
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return; }

    await page.goto(`/brands?search=${encodeURIComponent(sortQuery)}`);
    const sortSelect = page.getByRole('combobox', { name: '排序方式' });
    await sortSelect.selectOption('name');
    await expect(page).toHaveURL((url) =>
      url.pathname === '/brands'
      && url.searchParams.get('search') === sortQuery
      && url.searchParams.get('sort') === 'name',
    );

    const names = await page.locator('main [role="list"] [role="listitem"] h3').allTextContents();
    expect(names).toEqual([sortFirstName, sortLastName]);
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
          results: [{ id: 'latest', name: 'Latest Result', slug: 'latest', category: 'home' }],
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
        results: [{ id: 'stale', name: 'Stale Result', slug: 'stale', category: 'home' }],
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
    await expect(emptyState).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(page.getByText('共 0 個品牌', { exact: true })).toBeVisible();
    // A scope-note absence assertion used to sit here. Its string came from a
    // `scopeNote` key whose renderer was already deleted earlier in this delta;
    // this sweep removed the orphaned key, leaving an assertion no component
    // could ever violate. The 找不到品牌 guard below is the one that matters —
    // that copy is still live, and it must not appear alongside the real
    // 找不到符合的品牌 empty-state heading.
    await expect(page.getByText('找不到品牌', { exact: true })).toHaveCount(0);
    await expect(page.getByText('目前套用條件', { exact: true })).toHaveCount(0);
    await expect(emptyState.getByRole('heading', { name: '找不到符合的品牌' })).toBeVisible();
    // The empty state no longer echoes the query back — the notice banner that
    // did was removed. The search box is now the only place the raw string is
    // rendered, so that is where the escaping guard has to point.
    await expect(
      page.locator('form[role="search"] input[role="searchbox"]:visible').first(),
    ).toHaveValue(missingQuery);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(emptyState.getByRole('heading', { name: '類似的選擇' })).toBeVisible();
    await expect(emptyState.getByRole('link', { name: '查看全部' })).toBeVisible();
  });
});
