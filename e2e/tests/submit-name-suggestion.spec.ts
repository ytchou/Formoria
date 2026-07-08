import { test, expect } from '../fixtures/auth';
import { gotoSubmitRecommend } from '../utils/submit-form';

// ---------------------------------------------------------------------------
// Journey: Name cleanup suggestion
// When the user enters a dirty brand name and blurs the field, a suggestion
// alert appears with the cleaned name and an Apply button.  Clicking Apply
// replaces the field value and dismisses the alert.
//
// The form is now a single flat screen — the brand name field is visible
// immediately after navigation with no wizard step or skip required.
// ---------------------------------------------------------------------------
test.describe('Submit name suggestion', () => {
  test('dirty name with emoji shows suggestion alert; Apply updates field and dismisses alert', async ({
    userPage,
  }) => {
    test.setTimeout(60_000);

    await gotoSubmitRecommend(userPage);

    // Name field is immediately visible on the flat single-screen form
    const nameInput = userPage.locator('#submit-name');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    // Type a name that contains an emoji — triggers the emoji cleanup pattern
    await nameInput.fill('TestBrand🥑');

    // Blur via Tab key (more reliable than .blur() for triggering React onBlur)
    await nameInput.press('Tab');

    // Suggestion alert must appear — locate by unique content rather than
    // bare role="alert" (avoids collision with route announcer / other alerts)
    const suggestionAlert = userPage.getByText('建議名稱：');
    await expect(suggestionAlert).toBeVisible({ timeout: 15_000 });

    // Alert body contains the cleaned name
    const alertContainer = suggestionAlert.locator('..');
    await expect(alertContainer).toContainText('TestBrand');

    // Apply button is present
    const applyBtn = userPage.getByRole('button', {
      name: '套用',
      exact: true,
    });
    await expect(applyBtn).toBeVisible();

    // Click Apply — the suggestion div can be re-rendered mid-interaction
    // (React reconciliation / Turnstile onSuccess re-render); toPass retries the
    // click if Playwright detects the element was replaced between resolution and
    // event dispatch.
    await expect(async () => {
      await applyBtn.click({ timeout: 3_000 });
    }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });

    // Field now holds the cleaned name
    await expect(nameInput).toHaveValue('TestBrand');

    // Suggestion alert must disappear after Apply
    await expect(suggestionAlert).not.toBeVisible();
  });

  test('editing the name after suggestion dismisses the alert', async ({
    userPage,
  }) => {
    test.setTimeout(60_000);

    await gotoSubmitRecommend(userPage);

    // Name field is immediately visible — no skip step needed
    const nameInput = userPage.locator('#submit-name');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    await nameInput.fill('TestBrand🥑');
    await nameInput.press('Tab');

    const suggestionAlert = userPage.getByText('建議名稱：');
    await expect(suggestionAlert).toBeVisible({ timeout: 15_000 });

    // User resumes typing — onChange clears the suggestion
    await nameInput.focus();
    await nameInput.fill('TestBrand Updated');

    await expect(suggestionAlert).not.toBeVisible();
  });
});
