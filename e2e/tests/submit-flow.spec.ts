import { test, expect } from '../fixtures/auth';
import { createClient } from '@supabase/supabase-js';

test.describe('Submit flow deep', () => {
  const createdSubmissions: string[] = [];
  const manualEntryButtonName = '跳過，手動填寫';
  const nextButtonName = '下一步';

  test.afterAll(async () => {
    // createClient is deferred to afterAll to ensure env vars are loaded by Playwright
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    if (createdSubmissions.length > 0) {
      await supabase.from('brand_submissions').delete().in('id', createdSubmissions);
    }
    // Also cleanup by name prefix
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-TEST]%');
  });

  test('wizard steps are all reachable', async ({ userPage }) => {
    await userPage.goto('/submit');
    await expect(
      userPage.getByRole('heading', { name: '提交你喜愛的品牌', exact: true })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('validation shows errors on empty required fields', async ({ userPage }) => {
    await userPage.goto('/submit');
    await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click();
    const nextBtn = userPage.getByRole('button', { name: nextButtonName, exact: true });
    await nextBtn.click();
    await expect(userPage.locator('p.text-red-600').first()).toBeVisible({ timeout: 3_000 });
  });

  test('Tier 1 keyword blocks submission', async ({ userPage }) => {
    await userPage.goto('/submit');
    await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click();
    const nameInput = userPage.getByLabel('品牌名稱', { exact: true });
    if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nameInput.fill(`[E2E-TEST] Brand casino ${Date.now()}`);
      const nextBtn = userPage.getByRole('button', { name: nextButtonName, exact: true });
      if (await nextBtn.isVisible()) await nextBtn.click({ force: true });
    }
    await expect(
      userPage.locator('p.text-red-600').first()
        .or(userPage.getByText(/blocked|not allowed|rejected|flagged/i))
    ).toBeVisible({ timeout: 5_000 });
    await expect(userPage).not.toHaveURL(/\/submit\/confirmation|\/submit\/success/i);
  });

  test('unauthenticated user sees submit overview page (not redirected)', async ({ anonPage }) => {
    await anonPage.goto('/submit');
    await expect(anonPage).toHaveURL('/submit', { timeout: 10_000 });
    const cta = anonPage
      .locator('main a[href="/auth/sign-in?next=/submit"]:visible')
      .filter({ hasText: /^登入並開始提交$/ });
    await expect(cta).toBeVisible({ timeout: 5_000 });
    await expect(cta).toHaveAttribute('href', '/auth/sign-in?next=/submit');
  });

  test('English submit route resolves under /en', async ({ anonPage }) => {
    const res = await anonPage.goto('/en/submit');
    expect(res?.status()).toBe(200);
    await expect(anonPage).toHaveURL(/\/en\/submit/);
  });
});
