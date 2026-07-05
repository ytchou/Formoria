import { test, expect } from '../fixtures/auth';

// Routing context (DEV-930):
// - /guides bare is caught by the brand-slug redirect middleware → /brands/guides (like /glossary).
//   Until "guides" is added to RESERVED_ROUTES + PUBLIC_INTL_SEGMENTS in middleware.ts,
//   tests that need the hub to load navigate directly via /zh-TW/guides.
// - Category filter links on the hub use /guides?category=… (no locale prefix), so clicking
//   them from /zh-TW/guides currently redirects to /brands/guides?category=…; those tests
//   will fail until the routing gap is closed.
// - The guide card href is /guides/taiwan-skincare-brands (2-segment path, no brand-slug
//   redirect); that path returns 404 today because intl middleware is not invoked for it.

test.describe('Guides hub smoke', () => {
  test('nav has visible 指南 link pointing to /guides', async ({ anonPage }) => {
    await anonPage.goto('/');
    const guidesLink = anonPage.getByRole('link', { name: '指南' });
    await expect(guidesLink).toBeVisible({ timeout: 10_000 });
    await expect(guidesLink).toHaveAttribute('href', '/guides');
  });

  test('clicking 指南 nav link arrives at guides hub', async ({ anonPage }) => {
    await anonPage.goto('/');
    await anonPage.getByRole('link', { name: '指南' }).click();
    // Default zh-TW locale — must land at /guides (no prefix) once routing is complete
    await expect(anonPage).toHaveURL(/\/guides(?:[?#]|$)/, { timeout: 15_000 });
    await expect(
      anonPage.getByRole('heading', { name: '台灣品牌指南', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('guides hub renders heading and at least one guide card', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/guides');
    await expect(
      anonPage.getByRole('heading', { name: '台灣品牌指南', level: 1 })
    ).toBeVisible({ timeout: 10_000 });
    // At least one guide card link visible in main
    await expect(anonPage.locator('main a[href*="/guides/"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('category filter pill updates URL with ?category= and stays on hub', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/guides');
    const categoryNav = anonPage.getByRole('navigation', { name: 'Guide categories' });
    await expect(categoryNav).toBeVisible({ timeout: 10_000 });
    // Scoped to Guide categories nav to avoid clicking the brand category bar
    await categoryNav.getByRole('link', { name: '美妝保養' }).click();
    await expect(anonPage).toHaveURL(/[?&]category=beauty/, { timeout: 10_000 });
    // Must remain on guides hub — not redirected to /brands
    await expect(
      anonPage.getByRole('heading', { name: '台灣品牌指南', level: 1 })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('All pill clears category filter and stays on hub', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/guides?category=beauty');
    const categoryNav = anonPage.getByRole('navigation', { name: 'Guide categories' });
    await expect(categoryNav).toBeVisible({ timeout: 10_000 });
    await categoryNav.getByRole('link', { name: 'All' }).click();
    await expect(anonPage).not.toHaveURL(/[?&]category=/, { timeout: 10_000 });
    await expect(
      anonPage.getByRole('heading', { name: '台灣品牌指南', level: 1 })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('guide card click navigates to /guides/[slug] detail page', async ({ anonPage }) => {
    await anonPage.goto('/zh-TW/guides');
    const firstCard = anonPage.locator('main a[href*="/guides/"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();
    await expect(anonPage).toHaveURL(/\/guides\/[a-z][a-z0-9-]+/, { timeout: 15_000 });
    // Must not be a 404 — guide detail should render its own h1
    await expect(anonPage).not.toHaveTitle(/^404/);
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  });
});
