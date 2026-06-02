import { test, expect } from '../fixtures/auth';

test.describe('Categories index', () => {
  test('renders the categories index and follows a category link when one is available', async ({
    anonPage,
  }) => {
    const response = await anonPage.goto('/categories');
    expect(response?.status()).toBe(200);

    // Generous timeout for streamed server component content
    await expect(
      anonPage.getByRole('heading', { level: 1, name: '依類別瀏覽', exact: true })
    ).toBeVisible({ timeout: 20_000 });

    // Wait for network to settle so streamed category links are in the DOM
    await anonPage.waitForLoadState('networkidle');

    const categoryLinks = anonPage.locator('main a[href^="/categories/"]');
    const categoryLinkCount = await categoryLinks.count();

    if (categoryLinkCount === 0) {
      // No category data available — index heading assertion was sufficient
      return;
    }

    const firstCategoryLink = categoryLinks.first();
    await expect(firstCategoryLink).toBeVisible({ timeout: 15_000 });

    const href = await firstCategoryLink.getAttribute('href');
    expect(href).toBeTruthy();
    if (!href) {
      throw new Error('Expected category link to have an href');
    }
    expect(href).toMatch(/^\/categories\/[^/]+$/);

    await firstCategoryLink.click();
    await anonPage.waitForURL(/\/categories\/[^/]+$/, { timeout: 15_000 });

    // Filtered category page also streams — tolerate both brand grid and empty state
    await expect(
      anonPage
        .locator('[role="list"][aria-label="Brand directory"]')
        .or(anonPage.getByText('找不到品牌', { exact: true }))
    ).toBeVisible({ timeout: 20_000 });
  });
});
