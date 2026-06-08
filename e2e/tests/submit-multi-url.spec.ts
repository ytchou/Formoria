import { test, expect } from '../fixtures/auth'
import { gotoSubmitWizard } from '../utils/submit-wizard'

test.describe('Submit multi-URL affordances', () => {
  test('adds URL rows up to the cap and removes a row', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitWizard(userPage)

    const urlInputs = userPage.locator('input[type="url"]')

    // '新增連結' is the exact translated label for the add-URL button
    const addLinkButton = userPage.getByRole('button', { name: '新增連結', exact: true })
    await addLinkButton.click()
    await addLinkButton.click()

    await expect(urlInputs).toHaveCount(3)
    await expect(addLinkButton).toBeHidden()

    // Remove button has aria-label '移除連結'
    await userPage.getByRole('button', { name: '移除連結', exact: true }).first().click()
    await expect(urlInputs).toHaveCount(2)
  })
})
