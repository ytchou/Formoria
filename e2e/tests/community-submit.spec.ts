import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'

test.describe('Community submit flow', () => {
  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-COMMUNITY]%')
  })

  test('community submitter sees owner checkbox on URL step', async ({ userPage }) => {
    await userPage.goto('/submit')
    await expect(userPage.getByRole('checkbox', { name: /brand owner|品牌所有者/i }))
      .toBeVisible({ timeout: 5_000 })
  })

  test('source attribution dropdown appears when owner unchecked', async ({ userPage }) => {
    await userPage.goto('/submit')
    const ownerCheckbox = userPage.getByRole('checkbox', { name: /brand owner|品牌所有者/i })
    // Default: unchecked — attribution dropdown should be visible
    await expect(userPage.getByRole('combobox', { name: /know this brand|認識這個品牌/i }))
      .toBeVisible({ timeout: 3_000 })
    // Check owner — attribution dropdown should hide
    await ownerCheckbox.check()
    await expect(userPage.getByRole('combobox', { name: /know this brand|認識這個品牌/i }))
      .not.toBeVisible()
  })

  test('community submit skips logo and purchase links without error', async ({ userPage }) => {
    await userPage.goto('/submit')

    // Skip URL scraping
    await userPage.getByRole('button', { name: /skip|跳過/i }).click()

    // Brand Info step — fill required fields, leave logo empty
    await userPage.locator('#brand-name').fill('[E2E-COMMUNITY] Test Brand')
    await userPage.locator('#brand-description').fill('A community-submitted test brand for E2E')
    // Select category (exact selector TBD based on component)
    const categoryTrigger = userPage.getByRole('combobox', { name: /category|類別/i }).first()
    if (await categoryTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await categoryTrigger.click()
      await userPage.getByRole('option').first().click()
    }
    // Proceed without uploading logo
    await userPage.getByRole('button', { name: /next|continue|下一步/i }).first().click()

    // Products step — skip
    await userPage.getByRole('button', { name: /next|continue|下一步/i }).first().click()

    // Links step — proceed without purchase links
    await userPage.getByRole('button', { name: /next|continue|下一步/i }).first().click()

    // Should reach Review step without validation error on logo/links
    await expect(
      userPage.locator('[data-testid="review-step"], [data-testid="step-4"]')
        .or(userPage.getByRole('heading', { name: /review|確認/i }))
    ).toBeVisible({ timeout: 5_000 })
  })

  test('my-submissions page shows authenticated user submissions', async ({ userPage }) => {
    await userPage.goto('/my-submissions')
    await expect(userPage.getByRole('heading', { name: /my submissions|我的提交/i }))
      .toBeVisible({ timeout: 5_000 })
  })
})
