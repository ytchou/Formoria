import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { seedBrand, SeededBrand } from '../helpers/seed';

/**
 * Crowd-QA corrections (DEV-1170).
 *
 * Journey: an anonymous visitor spots a wrong value in the brand header,
 * taps the quiet "這不對?" trigger next to it, proposes a different value,
 * and submits. No account required. The proposal lands in a pending queue and
 * the public page keeps showing the original value until an admin approves it.
 *
 * Admin approval is deliberately out of scope here — admin review paths are
 * exercised elsewhere and excluded from this journey.
 */

// zh-TW is the default locale (playwright.config sets `locale: 'zh-TW'`).
// Strings below are the literal values in messages/zh-TW.json.
const CATEGORY_TRIGGER_NAME = '修正類別'; // brandDetail.correction.triggerLabel
const CATEGORY_TRIGGER_TEXT = '這不對?'; // brandDetail.correction.trigger
const CATEGORY_SHEET_TITLE = '分類'; // dashboard.edit.fieldCategory
const SUBMIT_LABEL = '送出修正'; // brandDetail.correction.submit
const CANCEL_LABEL = '取消'; // dashboard.edit.cancel
const REVIEW_PROMISE = '送出後由編輯審核，通過才會更新。'; // brandDetail.correction.description
const SUCCESS_TOAST = '修正已送出，感謝你的協助。'; // brandDetail.correction.success
const ALREADY_SUBMITTED_TOAST = '你已經送出過這項修正，請等待審核。'; // ...correction.errors.already_submitted

// seedBrand() always writes product_type: 'crafts'
const CURRENT_CATEGORY_SLUG = 'crafts';
const CURRENT_CATEGORY_LABEL = '工藝文創';
const PROPOSED_CATEGORY_SLUG = 'stationery';
const PROPOSED_CATEGORY_LABEL = '文具設計';

/**
 * Correction submits and `/brands/` page loads are both rate limited per client
 * IP. Every Playwright worker shares one loopback IP, so without this each test
 * spends the same budget and a CI retry tips the suite into 429s / "rate_limited"
 * toasts that have nothing to do with the behaviour under test. Presenting each
 * test as a distinct visitor IP is what actually happens in production.
 */
let visitorSeq = 0;
async function isolateVisitorIp(page: Page, workerIndex: number): Promise<void> {
  visitorSeq += 1;
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `203.0.113.${((workerIndex * 16 + visitorSeq) % 254) + 1}`,
  });
}

// Sonner renders toasts as a plain <li data-sonner-toast data-type="success|error">
// with no ARIA role, so there is no role=alert query here (and therefore nothing
// to filter the Next.js route announcer out of). data-type keeps a rejection from
// passing as a success.
async function expectToast(
  page: Page,
  type: 'success' | 'error',
  text: string,
): Promise<void> {
  await expect(
    page.locator(`[data-sonner-toast][data-type="${type}"]`).filter({ hasText: text }),
  ).toBeVisible({ timeout: 15_000 });
}

// Brand detail is force-static with 1h ISR — a freshly seeded brand needs a
// poll-reload before it renders.
async function openSeededBrand(page: Page, seeded: SeededBrand): Promise<void> {
  await expect(async () => {
    await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(seeded.brand.name, {
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 10_000] });
}

function categoryTrigger(page: Page) {
  return page.getByRole('button', { name: CATEGORY_TRIGGER_NAME, exact: true });
}

function categorySheet(page: Page) {
  return page.getByRole('dialog', { name: CATEGORY_SHEET_TITLE });
}

// The value cell the correction trigger belongs to. Scoping here matters:
// the category label also appears in the breadcrumb and the related-brands rail.
function categoryValue(page: Page) {
  return categoryTrigger(page).locator('xpath=ancestor::dd[1]');
}

// The brand page is statically served and hydrates afterwards, so a click that
// lands too early is a no-op. Retry the (idempotent) open until the sheet is up
// rather than sleeping on a guessed hydration delay.
async function openCategorySheet(page: Page) {
  const sheet = categorySheet(page);
  await expect(async () => {
    if (!(await sheet.isVisible())) await categoryTrigger(page).click();
    await expect(sheet).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
  return sheet;
}

async function proposeCategoryChange(page: Page) {
  const sheet = await openCategorySheet(page);
  await sheet
    .getByRole('combobox', { name: CATEGORY_SHEET_TITLE })
    .selectOption(PROPOSED_CATEGORY_SLUG);
  const submit = sheet.getByRole('button', { name: SUBMIT_LABEL, exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  return sheet;
}

test.describe('Brand corrections — anonymous crowd QA', () => {
  test.skip(process.env.PREVIEW_MODE === 'true', 'PREVIEW_MODE active — skipping DB-write test');

  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: 'corrections',
      status: 'approved',
      workerIndex: workerInfo.workerIndex,
    });
  });

  // brand_field_corrections cascades on brands delete, so this sweeps the
  // pending rows these tests create as well.
  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test(
    'anonymous visitor can submit a category correction',
    async ({ anonPage }, testInfo) => {
      test.setTimeout(90_000);
      await isolateVisitorIp(anonPage, testInfo.workerIndex);
      await openSeededBrand(anonPage, seeded);

      // Quiet trigger sitting beside the 類別 value; visible text is short, the
      // accessible name says which field it corrects.
      const trigger = categoryTrigger(anonPage);
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveText(CATEGORY_TRIGGER_TEXT);

      const sheet = await openCategorySheet(anonPage);
      await expect(sheet.getByRole('button', { name: CANCEL_LABEL, exact: true })).toBeVisible();

      // Anonymous by design: the sheet asks for a value, never for an account.
      await expect(sheet.getByRole('link', { name: /登入|sign in/i })).toHaveCount(0);
      await expect(sheet.getByText(REVIEW_PROMISE)).toBeVisible();

      await sheet
        .getByRole('combobox', { name: CATEGORY_SHEET_TITLE })
        .selectOption(PROPOSED_CATEGORY_SLUG);
      await sheet.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

      await expectToast(anonPage, 'success', SUCCESS_TOAST);
      await expect(sheet).toBeHidden();

      // Never bounced to sign-in. (Site chrome legitimately links to sign-in for
      // anonymous visitors, so the no-auth check is scoped to the sheet above.)
      await expect(anonPage).toHaveURL(new RegExp(`/brands/${seeded.slug}`));
    },
  );

  test('submit stays disabled until the value changes', async ({ anonPage }, testInfo) => {
    test.setTimeout(90_000);
    await isolateVisitorIp(anonPage, testInfo.workerIndex);
    await openSeededBrand(anonPage, seeded);

    const sheet = await openCategorySheet(anonPage);
    const select = sheet.getByRole('combobox', { name: CATEGORY_SHEET_TITLE });
    const submit = sheet.getByRole('button', { name: SUBMIT_LABEL, exact: true });

    // Opens on the brand's current category — there is nothing to propose yet.
    await expect(select).toHaveValue(CURRENT_CATEGORY_SLUG);
    await expect(submit).toBeDisabled();

    await select.selectOption(PROPOSED_CATEGORY_SLUG);
    await expect(submit).toBeEnabled();

    // Going back to the original value re-disables it.
    await select.selectOption(CURRENT_CATEGORY_SLUG);
    await expect(submit).toBeDisabled();
  });

  test(
    'page still shows the original value after submitting',
    async ({ anonPage }, testInfo) => {
      test.setTimeout(90_000);
      await isolateVisitorIp(anonPage, testInfo.workerIndex);
      await openSeededBrand(anonPage, seeded);

      await expect(categoryValue(anonPage)).toContainText(CURRENT_CATEGORY_LABEL);

      const sheet = await proposeCategoryChange(anonPage);
      await expectToast(anonPage, 'success', SUCCESS_TOAST);
      await expect(sheet).toBeHidden();

      // Pending, not applied: the header must still read the original category.
      await expect(categoryValue(anonPage)).toContainText(CURRENT_CATEGORY_LABEL);
      await expect(categoryValue(anonPage)).not.toContainText(PROPOSED_CATEGORY_LABEL);

      await anonPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(categoryValue(anonPage)).toContainText(CURRENT_CATEGORY_LABEL);
      await expect(categoryValue(anonPage)).not.toContainText(PROPOSED_CATEGORY_LABEL);
    },
  );

  test('a second submission for the same field is rejected', async ({ anonPage }, testInfo) => {
    test.setTimeout(120_000);
    await isolateVisitorIp(anonPage, testInfo.workerIndex);
    await openSeededBrand(anonPage, seeded);

    await proposeCategoryChange(anonPage);
    await expectToast(anonPage, 'success', SUCCESS_TOAST);

    // Same browser, same brand, same field — only one pending correction is allowed.
    await anonPage.reload({ waitUntil: 'domcontentloaded' });
    const sheet = await proposeCategoryChange(anonPage);

    await expectToast(anonPage, 'error', ALREADY_SUBMITTED_TOAST);
    // The sheet stays open on failure so the visitor can see what happened.
    await expect(sheet).toBeVisible();
  });
});
