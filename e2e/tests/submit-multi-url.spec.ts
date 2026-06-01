import { test, expect } from '../fixtures/auth'

test.describe('Submit multi-URL affordances', () => {
  test('adds URL rows up to the cap and removes a row', async ({ userPage }) => {
    await userPage.goto('/submit')

    const urlInputs = userPage.locator('input[type="url"]')
    await expect(urlInputs.first()).toBeVisible({ timeout: 5_000 })

    const addLinkButton = userPage.getByRole('button', { name: /add another link|新增/i })
    await addLinkButton.click()
    await addLinkButton.click()

    await expect(urlInputs).toHaveCount(3)
    await expect(addLinkButton).toBeHidden()

    await userPage.getByRole('button', { name: /remove|移除|刪除/i }).first().click()
    await expect(urlInputs).toHaveCount(2)
  })
})
