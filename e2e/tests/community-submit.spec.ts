import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'

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
    await userPage.goto('/submit')
    await expect(userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true }))
      .toBeVisible({ timeout: 5_000 })
  })

  test('source attribution dropdown appears when owner unchecked', async ({ userPage }) => {
    await userPage.goto('/submit')
    const ownerCheckbox = userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true })
    await expect(userPage.getByRole('combobox', { name: attributionFieldName, exact: true }))
      .toBeVisible({ timeout: 3_000 })
    await ownerCheckbox.check()
    await expect(userPage.getByRole('combobox', { name: attributionFieldName, exact: true }))
      .not.toBeVisible()
  })

  test('community submitter reaches brand info step and sees required fields', async ({ userPage }) => {
    await userPage.goto('/submit')

    await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click()

    // Brand Info step (step 1) should be active
    await expect(
      userPage.locator('[data-state="active"]').filter({ hasText: /^1\s+品牌資訊$/ })
    ).toBeVisible({ timeout: 5_000 })

    // Required fields are present
    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 3_000 })
    await expect(userPage.locator('#brand-description')).toBeVisible({ timeout: 3_000 })

    const categoryTrigger = userPage.getByRole('combobox', { name: 'Category', exact: true })
    if (await categoryTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await categoryTrigger.selectOption({ index: 1 })
    }
  })

  test('my-submissions page shows authenticated user submissions', async ({ userPage }) => {
    await userPage.goto('/my-submissions')
    await expect(userPage.getByRole('heading', { name: /my submissions|我的提交/i }))
      .toBeVisible({ timeout: 5_000 })
  })

  test('my-submissions renders English copy under /en', async ({ userPage }) => {
    const res = await userPage.goto('/en/my-submissions')
    expect(res?.status()).toBe(200)
    await expect(userPage.getByRole('heading', { name: /my submissions/i })).toBeVisible({
      timeout: 10_000,
    })
  })
})
