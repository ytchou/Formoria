import { test, expect } from '../fixtures/auth'

test.describe('Where-to-buy directory', () => {
  test('browses from the index to a city and reaches a district section', async ({ anonPage }) => {
    const response = await anonPage.goto('/where-to-buy')
    expect(response?.status()).toBe(200)
    await anonPage.locator('main a[href="/where-to-buy/taipei"]').first().click()
    const districtLink = anonPage.locator('main a[href*="#"]').first()
    await expect(districtLink).toBeVisible()
    await districtLink.click()
    await expect(anonPage).toHaveURL(/\/where-to-buy\/taipei#[a-z0-9-]+/)
    const targetId = new URL(anonPage.url()).hash.slice(1)
    await expect(anonPage.locator(`h2#${targetId}`)).toBeFocused()
    await expect(anonPage.locator(`h2#${targetId}`).locator('xpath=..').locator('li').first()).toBeVisible()
  })

  test('renders locations without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      const response = await page.goto('/where-to-buy/taipei')
      expect(response?.status()).toBe(200)
      await expect(page.locator('main').getByText('南京西路').first()).toBeVisible()
      await expect(page.locator('main a[href*="google.com/maps/search"]').first()).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('filters by category without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      await page.goto('/where-to-buy/taipei')
      const filter = page.locator('main a[href*="?category="]').first()
      const href = await filter.getAttribute('href')
      expect(href).toBeTruthy()
      const response = await page.goto(href!)
      expect(response?.status()).toBe(200)
      await expect(page).toHaveURL(/[?&]category=/)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('returns 404 for an unknown city', async ({ anonPage }) => {
    const response = await anonPage.goto('/where-to-buy/not-a-real-city')
    expect(response?.status()).toBe(404)
  })

  test('serves both locales', async ({ anonPage }) => {
    const zh = await anonPage.goto('/where-to-buy/taipei')
    expect(zh?.status()).toBe(200)
    await expect(anonPage.locator('html')).toHaveAttribute('lang', 'zh-TW')
    const en = await anonPage.goto('/en/where-to-buy/taipei')
    expect(en?.status()).toBe(200)
    await expect(anonPage.locator('html')).toHaveAttribute('lang', 'en')
  })
})
