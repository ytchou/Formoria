import { test, expect } from '@playwright/test'

test('glossary renders grouped definitions with DefinedTermSet JSON-LD', async ({ page }) => {
  await page.goto('/glossary')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('台灣製造')).toBeVisible()
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
  const hasTermSet = blocks.some((b) => b.includes('"DefinedTermSet"'))
  expect(hasTermSet).toBe(true)
})

test('footer links to the glossary', async ({ page }) => {
  await page.goto('/')
  const link = page.locator('footer a[href$="/glossary"]')
  await expect(link.first()).toBeVisible()
})
