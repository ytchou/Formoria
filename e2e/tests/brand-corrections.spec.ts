import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { seedBrand, SeededBrand } from '../helpers/seed';
import { BUDGET, POLL } from '../budgets';

const IS_CANONICAL_STAGING_TARGET =
  new URL(
    process.env.BASE_URL ??
      process.env.PLAYWRIGHT_BASE_URL ??
      process.env.STAGING_BASE_URL ??
      'http://localhost:3000',
  ).origin === 'https://staging.formoria.com';
const STAGING_MUTATION_SKIP_REASON =
  'Anonymous correction mutations are intentionally disabled on canonical staging';
// DEV-1261 note: deliberately NOT gated on `owner_features_enabled`. This is an
// anonymous crowd-QA journey that touches no owner surface, and it is live at
// launch — pausing it would take consumer coverage dark for no reason. Verified
// green with the flag off.

/**
 * Crowd-QA corrections (DEV-1170).
 *
 * Journey: an anonymous visitor spots a wrong value in the brand header, taps
 * the single quiet "資料有誤?" trigger next to the 品牌資訊 heading, picks which
 * field is wrong, proposes a different value, and submits. No account required.
 * The proposal lands in a pending queue and the public page keeps showing the
 * original value until an admin approves it.
 *
 * The value control is a two-row chip picker (DEV-1244): row 1 is the brand's
 * current value, row 2 is everything else.
 *
 * Scope: only what crosses the server boundary. The dialog's own behaviour —
 * submit gating, the delta payload, the subcategory cap, and the DEV-1510 closed
 * vocabulary that refuses an unknown term — is owned by
 * `src/components/brands/__tests__/correction-dialog.test.tsx`, which asserts all
 * of it without a browser or a seeded brand.
 *
 * Admin approval is deliberately out of scope here — admin review paths are
 * exercised elsewhere and excluded from this journey.
 */

// zh-TW is the default locale (playwright.config sets `locale: 'zh-TW'`).
// Strings below are the literal values in messages/zh-TW.json.
// The trigger has no aria-label: its visible text IS its accessible name
// (WCAG 2.5.3), so one constant covers both the role query and the text check.
const CORRECTION_TRIGGER_TEXT = '資料有誤?'; // brandDetail.correction.trigger
const CORRECTION_DIALOG_TITLE = '修正品牌資訊'; // brandDetail.correction.title
const FIELD_PICKER_LABEL = '要修正哪一項?'; // brandDetail.correction.fieldPickerLabel
// The value control is two role="group" rows. Row 1 (the brand's current value)
// is named by the 目前 heading; row 2 (the options a visitor may pick) is named
// by the field label itself, so 品牌類別 addresses the options row, not the current one.
const CURRENT_VALUE_LABEL = '目前'; // brandDetail.correction.currentHeading
const CATEGORY_VALUE_LABEL = '品牌類別'; // brandDetail.label.category
const SUBMIT_LABEL = '送出修正'; // brandDetail.correction.submit
const CANCEL_LABEL = '取消'; // dashboard.edit.cancel
const REVIEW_PROMISE = '感謝提供建議！送出後由 Formoria 審核決定是否更新。'; // brandDetail.correction.description
const SUCCESS_TOAST = '修正已送出，感謝你的協助。'; // brandDetail.correction.success
const ALREADY_SUBMITTED_TOAST = '這項修正已經送出，請等待審核。'; // ...correction.errors.already_submitted

// seedBrand() always writes category: 'home' and no subcategories.
const CURRENT_CATEGORY_LABEL = '居家生活';
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
  ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
}

// Brand detail uses on-demand ISR with 1h revalidation — a freshly seeded brand
// needs a poll-reload before it renders.
async function openSeededBrand(page: Page, seeded: SeededBrand): Promise<void> {
  await expect(async () => {
    await page.goto(`/brands/${seeded.slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(seeded.brand.name, {
      timeout: BUDGET.INTERACTIVE,
    });
  }).toPass(POLL.DB);
}

function correctionTrigger(page: Page) {
  return page.getByRole('button', { name: CORRECTION_TRIGGER_TEXT, exact: true });
}

function correctionDialog(page: Page) {
  return page.getByRole('dialog', { name: CORRECTION_DIALOG_TITLE });
}

// The 品牌類別 value cell. Scoping here matters: the category value also appears
// in the breadcrumb and the related-brands rail. `:text-is` is exact on purpose
// so this can never select the 商品子類別 row.
function categoryValue(page: Page) {
  return page
    .locator('#brand-info-section > dl > div')
    .filter({ has: page.locator('dt:text-is("品牌類別")') })
    .locator('dd');
}

// The brand page is statically served and hydrates afterwards, so a click that
// lands too early is a no-op. Retry the (idempotent) open until the dialog is up
// rather than sleeping on a guessed hydration delay.
async function openCategoryDialog(page: Page) {
  // The trigger ships in the server-rendered HTML, so a missing one is never a
  // hydration race — it means the page under test doesn't have this feature at
  // all. Assert it up front: folded into the retry loop below it surfaces as an
  // opaque "predicate timed out" pointing at the dialog, which reads like a
  // broken dialog selector and sends debugging the wrong way.
  await expect(correctionTrigger(page)).toBeVisible();

  const dialog = correctionDialog(page);
  await expect(async () => {
    if (!(await dialog.isVisible())) await correctionTrigger(page).click();
    await expect(dialog).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  }).toPass(POLL.UI);
  // The field picker is the one control that is still a real <select>. The
  // picker opens on a disabled placeholder with no field selected, so the value
  // rows only exist after this selection.
  await dialog.getByRole('combobox', { name: FIELD_PICKER_LABEL }).selectOption('category');
  return dialog;
}

// Every chip lookup goes through one of these two. Bare
// getByRole('button', { name: '居家生活' }) is strict-mode ambiguous — the
// category labels also render in the breadcrumb and the related-brands rail.
function optionsRow(dialog: Locator, name: string) {
  return dialog.getByRole('group', { name });
}

function currentRow(dialog: Locator) {
  return dialog.getByRole('group', { name: CURRENT_VALUE_LABEL });
}

async function proposeCategoryChange(page: Page) {
  const dialog = await openCategoryDialog(page);
  await optionsRow(dialog, CATEGORY_VALUE_LABEL)
    .getByRole('button', { name: PROPOSED_CATEGORY_LABEL, exact: true })
    .click();
  const submit = dialog.getByRole('button', { name: SUBMIT_LABEL, exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  return dialog;
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
      test.skip(IS_CANONICAL_STAGING_TARGET, STAGING_MUTATION_SKIP_REASON);
      test.setTimeout(BUDGET.TEST.MUTATION);
      await isolateVisitorIp(anonPage, testInfo.workerIndex);
      await openSeededBrand(anonPage, seeded);

      // One quiet trigger beside the 品牌資訊 heading, named by its own visible
      // text. The field is picked inside the dialog.
      const trigger = correctionTrigger(anonPage);
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveText(CORRECTION_TRIGGER_TEXT);

      const dialog = await openCategoryDialog(anonPage);
      await expect(dialog.getByRole('button', { name: CANCEL_LABEL, exact: true })).toBeVisible();

      // Anonymous by design: the dialog asks for a value, never for an account.
      await expect(dialog.getByRole('link', { name: /登入|sign in/i })).toHaveCount(0);
      await expect(dialog.getByText(REVIEW_PROMISE)).toBeVisible();

      // Row 1 shows what the brand says today; row 2 offers everything else.
      await expect(currentRow(dialog)).toContainText(CURRENT_CATEGORY_LABEL);
      await optionsRow(dialog, CATEGORY_VALUE_LABEL)
        .getByRole('button', { name: PROPOSED_CATEGORY_LABEL, exact: true })
        .click();
      await dialog.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

      await expectToast(anonPage, 'success', SUCCESS_TOAST);
      await expect(dialog).toBeHidden();

      // Never bounced to sign-in. (Site chrome legitimately links to sign-in for
      // anonymous visitors, so the no-auth check is scoped to the dialog above.)
      await expect(anonPage).toHaveURL(new RegExp(`/brands/${seeded.slug}`));

      // Pending, NOT applied — folded in from a separate test that re-ran this
      // whole submit only to check the header afterwards. A crowd proposal must
      // land in the queue without touching the public value, before OR after a
      // reload.
      await expect(categoryValue(anonPage)).toContainText(CURRENT_CATEGORY_LABEL);
      await expect(categoryValue(anonPage)).not.toContainText(PROPOSED_CATEGORY_LABEL);
      await anonPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(categoryValue(anonPage)).toContainText(CURRENT_CATEGORY_LABEL);
      await expect(categoryValue(anonPage)).not.toContainText(PROPOSED_CATEGORY_LABEL);
    },
  );

  test('a second submission for the same field is rejected', async ({ anonPage }, testInfo) => {
    test.skip(IS_CANONICAL_STAGING_TARGET, STAGING_MUTATION_SKIP_REASON);
    test.setTimeout(BUDGET.TEST.ADMIN);
    await isolateVisitorIp(anonPage, testInfo.workerIndex);
    await openSeededBrand(anonPage, seeded);

    await proposeCategoryChange(anonPage);
    await expectToast(anonPage, 'success', SUCCESS_TOAST);

    // Same browser, same brand, same field — only one pending correction is allowed.
    await anonPage.reload({ waitUntil: 'domcontentloaded' });
    const dialog = await proposeCategoryChange(anonPage);

    await expectToast(anonPage, 'error', ALREADY_SUBMITTED_TOAST);
    // The dialog stays open on failure so the visitor can see what happened.
    await expect(dialog).toBeVisible();
  });
});
