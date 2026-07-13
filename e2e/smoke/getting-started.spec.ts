import { test, expect } from '@playwright/test';

test.describe('Getting Started page smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/getting-started');
  });

  test('hero section renders', async ({ page }) => {
    await expect(page.getByText('Explore Formoria')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Find your next favorite brand' })).toBeVisible();
  });

  test('How to explore Formoria section renders with 4 step cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'How to explore Formoria' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('article').filter({ hasText: 'Start with what interests you' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Open a brand listing' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Compare the details' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Save brands for later' })).toBeVisible();
  });

  test('While you browse section renders with checklist', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'While you browse' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Read the description and product details to understand what each brand offers.')).toBeVisible();
    await expect(page.getByText('Follow official links to learn more or shop directly from the brand.')).toBeVisible();
  });

  test('optional brand owner section renders with benefit cards', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'If you own a brand' });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    const section = page.locator('section').filter({ has: heading });
    await expect(section.getByRole('article').filter({ hasText: 'Claim Your Brand' })).toBeVisible();
    await expect(section.getByRole('article').filter({ hasText: 'Manage Your Listing' })).toBeVisible();
    await expect(section.getByRole('article').filter({ hasText: 'Track Performance' })).toBeVisible();
  });

  test('links to the dedicated FAQ page', async ({ page }) => {
    const faqLinks = page.getByRole('link', { name: 'Read the FAQ' });
    await expect(faqLinks.first()).toHaveAttribute('href', /\/faq/);
    await expect(faqLinks.last()).toHaveAttribute('href', /\/faq/);
  });

  test('CTA footer section renders and Browse link points to /brands', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Ready to explore Taiwan-made brands?' })).toBeVisible({ timeout: 10_000 });
    const browseLink = page.getByRole('link', { name: 'Browse brands' }).last();
    await expect(browseLink).toBeVisible();
    const href = await browseLink.getAttribute('href');
    expect(href).toMatch(/\/brands/);
  });

  test('footer contains Getting Started link', async ({ page }) => {
    const footerLink = page.getByRole('contentinfo').getByRole('link', { name: 'Getting Started' });
    await expect(footerLink).toBeVisible({ timeout: 10_000 });
  });
});
