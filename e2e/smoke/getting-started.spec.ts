import { test, expect } from '@playwright/test';

test.describe('Getting Started page smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/getting-started');
  });

  test('hero section renders', async ({ page }) => {
    await expect(page.getByText('Formoria onboarding')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Getting Started guide' })).toBeVisible();
  });

  test('How Formoria works section renders with 4 step cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'How Formoria works' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('article').filter({ hasText: 'Discover Taiwan-made brands' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Submit or suggest a brand' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Review and approval' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Claim and manage your listing' })).toBeVisible();
  });

  test('Before you submit section renders with checklist', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Before you submit' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Use accurate, public-facing brand information.')).toBeVisible();
    await expect(page.getByText('Include official links so reviewers can verify the submission.')).toBeVisible();
  });

  test('For Brand Owners section renders with benefit cards', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'For Brand Owners' });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    const section = page.locator('section').filter({ has: heading });
    await expect(section.getByRole('article').filter({ hasText: 'Claim Your Brand' })).toBeVisible();
    await expect(section.getByRole('article').filter({ hasText: 'Manage Your Listing' })).toBeVisible();
    await expect(section.getByRole('article').filter({ hasText: 'Track Performance' })).toBeVisible();
  });

  test('FAQ section renders with first item expanded', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Common questions' })).toBeVisible({ timeout: 10_000 });
    // defaultValue="eligibility" — first FAQ answer is visible on load
    await expect(
      page.getByText('Anyone can suggest a Taiwan-made brand. You do not need to own the brand to submit it for review.')
    ).toBeVisible();
  });

  test('FAQ accordion expands a second item on click', async ({ page }) => {
    await page.getByRole('heading', { name: 'Common questions' }).waitFor({ timeout: 10_000 });
    // Click the second FAQ item trigger
    await page.getByRole('button', { name: 'What information should I prepare?' }).click();
    await expect(
      page.getByText('Prepare the brand name, description, official website or social links')
    ).toBeVisible({ timeout: 5_000 });
  });

  test('CTA footer section renders and Submit link points to /submit', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Ready to add a Taiwan-made brand?' })).toBeVisible({ timeout: 10_000 });
    const submitLink = page.getByRole('link', { name: 'Submit a brand' }).last();
    await expect(submitLink).toBeVisible();
    const href = await submitLink.getAttribute('href');
    expect(href).toMatch(/\/submit/);
  });

  test('footer contains Getting Started link', async ({ page }) => {
    const footerLink = page.getByRole('contentinfo').getByRole('link', { name: 'Getting Started' });
    await expect(footerLink).toBeVisible({ timeout: 10_000 });
  });
});
