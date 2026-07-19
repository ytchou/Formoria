import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'
import { seedBrand } from '../helpers/seed'
import { gotoSubmitRecommend } from '../utils/submit-form'

const SUBMISSION_PREFIX = '[E2E-TEST] Submit Recommend Edge'

async function installTurnstileStub(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      get() {
        return {
          render(
            _element: HTMLElement,
            options: { callback: (token: string) => void },
          ) {
            setTimeout(() => options.callback('e2e-bypass-token'), 50)
            return 'fake-widget-id'
          },
          remove() {},
        }
      },
    })
  })
}

async function fillRequiredFields(
  page: Page,
  values: { name: string; website: string },
) {
  await page.locator('#submit-website').fill(values.website)
  await page.locator('#submit-name').fill(values.name)
  await page.locator('#submit-source').selectOption('found_online')
  await page.locator('#submit-pdpa').check()
}

test.describe('Submit recommendation edge cases', () => {
  test.describe.configure({ mode: 'serial' })

  let supabaseAdmin: SupabaseClient
  let duplicateBrandName = ''
  let cleanupDuplicateBrand: (() => Promise<void>) | undefined

  test.beforeAll(async ({}, workerInfo) => {
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const seeded = await seedBrand({
      name: 'Submit Recommend Duplicate',
      workerIndex: workerInfo.workerIndex,
    })
    duplicateBrandName = seeded.brand.name
    cleanupDuplicateBrand = seeded.cleanup
  })

  test.afterAll(async () => {
    await supabaseAdmin
      .from('brand_submissions')
      .delete()
      .like('brand_name', `${SUBMISSION_PREFIX}%`)
    await cleanupDuplicateBrand?.()
  })

  test('blocks a duplicate name and recovers after the visitor edits it', async ({
    anonPage,
  }) => {
    test.setTimeout(90_000)
    await installTurnstileStub(anonPage)
    await gotoSubmitRecommend(anonPage)

    await fillRequiredFields(anonPage, {
      name: duplicateBrandName,
      website: 'https://duplicate-recovery.example.com',
    })
    await anonPage.locator('#submit-name').press('Tab')

    await expect(
      anonPage.getByText('發現相似品牌名稱', { exact: true }),
    ).toBeVisible({ timeout: 15_000 })

    const submitButton = anonPage.getByRole('button', { name: '送出推薦' })
    await expect(submitButton).toBeDisabled()

    await anonPage
      .locator('#submit-name')
      .fill(`${SUBMISSION_PREFIX} Recovery ${Date.now()}`)

    await expect(
      anonPage.getByText('發現相似品牌名稱', { exact: true }),
    ).toHaveCount(0)
    await expect(submitButton).toBeEnabled({ timeout: 15_000 })
  })

  test('rapid repeat activation creates exactly one submission', async ({
    anonPage,
  }, workerInfo) => {
    test.setTimeout(90_000)
    const suffix = `${Date.now()}-${workerInfo.workerIndex}`
    const brandName = `${SUBMISSION_PREFIX} ${suffix}`

    await installTurnstileStub(anonPage)
    await gotoSubmitRecommend(anonPage)
    await fillRequiredFields(anonPage, {
      name: brandName,
      website: `https://submit-edge-${suffix}.example.com`,
    })

    const submitButton = anonPage.getByRole('button', { name: '送出推薦' })
    await expect(submitButton).toBeEnabled({ timeout: 15_000 })

    const attempts = await Promise.allSettled([
      submitButton.click({ timeout: 5_000 }),
      submitButton.click({ timeout: 5_000 }),
    ])
    expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true)

    await anonPage.waitForURL(/\/submit\/confirmation/, { timeout: 30_000 })
    await expect(
      anonPage.getByRole('heading', {
        name: '我們已收到你的品牌推薦',
      }),
    ).toBeVisible({ timeout: 15_000 })

    await anonPage.waitForTimeout(1_000)
    const { count, error } = await supabaseAdmin
      .from('brand_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('brand_name', brandName)

    expect(error).toBeNull()
    expect(count).toBe(1)
  })
})
