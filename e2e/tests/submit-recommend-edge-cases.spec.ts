import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'
import { POLL } from '../budgets'
import { seedBrand } from '../helpers/seed'
import { gotoSubmitRecommend } from '../utils/submit-form'

import { BUDGET } from '../budgets'
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
            options.callback('e2e-bypass-token')
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
  // DEV-1416 regression: a browser can submit the same recommendation six
  // times before the first response returns. This test must not retry because
  // a retry would hide a duplicate-row race behind a second clean run.
  test.describe.configure({ mode: 'serial', retries: 0 })

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
    const { error } = await supabaseAdmin
      .from('brand_submissions')
      .delete()
      .like('brand_name', `${SUBMISSION_PREFIX}%`)
    if (error) throw new Error(`[e2e-cleanup] submission edge cleanup failed: ${error.message}`)
    await cleanupDuplicateBrand?.()
  })

  test('blocks a duplicate name and recovers after the visitor edits it', async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    await installTurnstileStub(anonPage)
    await gotoSubmitRecommend(anonPage)

    await fillRequiredFields(anonPage, {
      name: duplicateBrandName,
      website: 'https://duplicate-recovery.example.com',
    })
    await anonPage.locator('#submit-name').press('Tab')

    // Not `exact`: the duplicate hit now renders as one red line that carries
    // the title and the matched brand links in the same paragraph, so the
    // element's full text is "發現相似品牌名稱 <brand>".
    await expect(
      anonPage.getByText('發現相似品牌名稱'),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER })

    const submitButton = anonPage.getByRole('button', { name: '送出推薦' })
    await expect(submitButton).toBeDisabled()

    await anonPage
      .locator('#submit-name')
      .fill(`${SUBMISSION_PREFIX} Recovery ${Date.now()}`)

    await expect(
      anonPage.getByText('發現相似品牌名稱'),
    ).toHaveCount(0)
    await expect(submitButton).toBeEnabled({ timeout: BUDGET.SERVER_RENDER })
  })

  test('rapid repeat activation creates exactly one submission', async ({
    anonPage,
  }, workerInfo) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const suffix = `${Date.now()}-${workerInfo.workerIndex}`
    const brandName = `${SUBMISSION_PREFIX} ${suffix}`

    await installTurnstileStub(anonPage)
    await gotoSubmitRecommend(anonPage)
    await fillRequiredFields(anonPage, {
      name: brandName,
      website: `https://submit-edge-${suffix}.example.com`,
    })

    const submitButton = anonPage.getByRole('button', { name: '送出推薦' })
    await expect(submitButton).toBeEnabled({ timeout: BUDGET.SERVER_RENDER })

    const attempts = await Promise.allSettled([
      submitButton.click({ timeout: BUDGET.RENDERED }),
      submitButton.click({ timeout: BUDGET.RENDERED }),
    ])
    expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true)

    await anonPage.waitForURL(/\/submit\/confirmation/, { timeout: BUDGET.GATED_UI })
    await expect(
      anonPage.getByRole('heading', {
        name: '我們已收到你的品牌推薦',
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER })

    // Poll the count instead of sleeping for a second and hoping the write has
    // landed. This also strengthens the assertion: a duplicate arriving *after*
    // the old fixed wait would have been missed entirely, and a duplicate is
    // precisely what this test exists to catch.
    await expect
      .poll(
        async () => {
          const { count, error } = await supabaseAdmin
            .from('brand_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('brand_name', brandName)
          expect(error).toBeNull()
          return count
        },
        POLL.UI,
      )
      .toBe(1)
  })

  test('DEV-1416 six concurrent browser submissions return one id and six confirmations', async ({
    browser,
  }, workerInfo) => {
    test.setTimeout(BUDGET.TEST.JOURNEY)
    const suffix = `${Date.now()}-${workerInfo.workerIndex}`
    const brandName = `${SUBMISSION_PREFIX} DEV-1416 ${suffix}`
    const website = `https://submit-dev-1416-${suffix}.example.com`
    const idempotencyKey = randomUUID()
    const pages = await Promise.all(Array.from({ length: 6 }, () => browser.newPage()))

    try {
      await Promise.all(
        pages.map(async (page) => {
          await page.addInitScript((key) => {
            Object.defineProperty(window.crypto, 'randomUUID', {
              configurable: true,
              value: () => key,
            })
          }, idempotencyKey)
          await installTurnstileStub(page)
          await gotoSubmitRecommend(page)
          await fillRequiredFields(page, { name: brandName, website })
        }),
      )

      const confirmations = await Promise.all(
        pages.map(async (page) => {
          const submitButton = page.getByRole('button', { name: '送出推薦' })
          await expect(submitButton).toBeEnabled({ timeout: BUDGET.SERVER_RENDER })
          await submitButton.click()
          await page.waitForURL(/\/submit\/confirmation/, { timeout: BUDGET.GATED_UI })
          await expect(page.getByRole('heading', { name: '我們已收到你的品牌推薦' })).toBeVisible({
            timeout: BUDGET.SERVER_RENDER,
          })
          const { data, error } = await supabaseAdmin
            .from('brand_submissions')
            .select('id')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle()
          expect(error).toBeNull()
          expect(data?.id).toBeTruthy()
          return { url: page.url(), id: data?.id }
        }),
      )
      expect(confirmations).toHaveLength(6)
      expect(confirmations.every(({ url }) => url.includes('/submit/confirmation'))).toBe(true)
      expect(new Set(confirmations.map(({ id }) => id)).size).toBe(1)

      await expect
        .poll(
          async () => {
            const { data, error } = await supabaseAdmin
              .from('brand_submissions')
              .select('id, brand_name, idempotency_key')
              .eq('idempotency_key', idempotencyKey)
            expect(error).toBeNull()
            return data ?? []
          },
          POLL.UI,
        )
        .toHaveLength(1)
      const { data: persisted, error: persistedError } = await supabaseAdmin
        .from('brand_submissions')
        .select('id, brand_name, idempotency_key')
        .eq('idempotency_key', idempotencyKey)
      expect(persistedError).toBeNull()
      expect(persisted).toHaveLength(1)
      expect(persisted?.[0]).toMatchObject({ brand_name: brandName, idempotency_key: idempotencyKey })
      expect(confirmations.map(({ id }) => id)).toEqual(Array(6).fill(persisted?.[0]?.id))
    } finally {
      const { error } = await supabaseAdmin
        .from('brand_submissions')
        .delete()
        .eq('idempotency_key', idempotencyKey)
      expect(error, 'DEV-1416 submission cleanup must succeed').toBeNull()
      await Promise.all(pages.map((page) => page.close()))
    }
  })
})
