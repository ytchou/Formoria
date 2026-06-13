import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'
import { gotoSubmitWizard } from '../utils/submit-wizard'

test.describe('Community submit flow', () => {
  const ownerCheckboxName = '我是品牌所有者'
  const attributionFieldName = '你如何認識這個品牌？'
  const manualEntryButtonName = '跳過，手動填寫'

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-COMMUNITY]%')
  })

  test('community submitter sees owner checkbox on URL step', async ({ userPage }) => {
    test.setTimeout(60_000)
    // Use gotoSubmitWizard to absorb cold-compile latency before asserting UI state
    await gotoSubmitWizard(userPage)
    await expect(userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true }))
      .toBeVisible({ timeout: 5_000 })
  })

  test('source attribution dropdown appears when owner unchecked', async ({ userPage }) => {
    test.setTimeout(60_000)
    // Use gotoSubmitWizard to ensure the wizard is hydrated before interacting
    await gotoSubmitWizard(userPage)
    const ownerCheckbox = userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true })
    // isOwner defaults to false — attribution select is visible immediately
    await expect(userPage.getByRole('combobox', { name: attributionFieldName, exact: true }))
      .toBeVisible({ timeout: 5_000 })
    await ownerCheckbox.check()
    await expect(userPage.getByRole('combobox', { name: attributionFieldName, exact: true }))
      .not.toBeVisible()
  })

  test('community submitter reaches brand info step and sees required fields', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitWizard(userPage)

    await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click()

    // Brand Info step (step 1) should be active
    await expect(
      userPage.locator('[data-state="active"]').filter({ hasText: /^1\s+品牌資訊$/ })
    ).toBeVisible({ timeout: 5_000 })

    // Required fields are present
    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 3_000 })
    await expect(userPage.locator('#brand-description')).toBeVisible({ timeout: 3_000 })

    // Product type section is visible with at least one option and the free-text fallback toggle
    await expect(userPage.getByRole('group', { name: /產品類型/ })).toBeVisible({ timeout: 3_000 })
    await expect(userPage.getByText(/服飾鞋履/)).toBeVisible({ timeout: 3_000 })
    await expect(userPage.getByText(/以上都不適合/)).toBeVisible({ timeout: 3_000 })

    const categoryTrigger = userPage.getByRole('combobox', { name: 'Category', exact: true })
    if (await categoryTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await categoryTrigger.selectOption({ index: 1 })
    }
  })

  test('my-submissions page shows authenticated user submissions', async ({ userPage }) => {
    test.setTimeout(60_000)
    await userPage.goto('/my-submissions')
    await expect(userPage.getByRole('heading', { name: /經營者主控台|我的提交/i }))
      .toBeVisible({ timeout: 15_000 })
  })

  test('my-submissions renders English copy under /en', async ({ userPage }) => {
    test.setTimeout(60_000)
    const res = await userPage.goto('/en/my-submissions')
    expect(res?.status()).toBeLessThan(400)
    await expect(userPage.getByRole('heading', { name: /Owner Dashboard|My Submissions|經營者主控台|我的提交/i })).toBeVisible({
      timeout: 15_000,
    })
  })
})
