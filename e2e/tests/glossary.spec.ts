import { test, expect } from '@playwright/test'

test('glossary renders grouped definitions with DefinedTermSet JSON-LD', async ({ page }) => {
  // /glossary (bare) is caught by the brand-slug redirect middleware → /brands/glossary (404).
  // The canonical zh-TW glossary URL requires an explicit locale prefix.
  await page.goto('/zh-TW/glossary')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
  // First term is "台灣製造·Made in Taiwan"; getByText uses partial matching
  await expect(page.getByText('台灣製造').first()).toBeVisible()
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
  const hasTermSet = blocks.some((b) => b.includes('"DefinedTermSet"'))
  expect(hasTermSet).toBe(true)
})

// Removed: footer glossary link test — footer.tsx does not include a /glossary link.
