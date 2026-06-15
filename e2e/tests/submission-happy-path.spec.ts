import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { gotoSubmitWizard } from '../utils/submit-wizard';

// 4x4 sRGB PNG — small enough for fast uploads, robust enough for libspng
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8AARwgWXg4ArpMP8aaUSCMAAAAASUVORK5CYII=';

const ownerCheckboxName = '我是品牌所有者';
const manualEntryButtonName = '跳過，手動填寫';
const nextButtonName = '下一步';

type ReactFiberNode = {
  child?: ReactFiberNode | null;
  sibling?: ReactFiberNode | null;
  return?: ReactFiberNode | null;
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: {
    onSuccess?: (token: string) => void;
  } | null;
};

async function triggerTurnstileSuccess(page: Page, token: string) {
  await page.evaluate((injectedToken) => {
    const getFiber = (element: Element | null): ReactFiberNode | null => {
      if (!element) return null;

      const host = element as Element & Record<string, unknown>;
      const fiberKey = Object.keys(host).find((key) => key.startsWith('__reactFiber$'));
      if (!fiberKey) return null;

      const fiber = host[fiberKey];
      return fiber && typeof fiber === 'object' ? (fiber as ReactFiberNode) : null;
    };

    const getComponentName = (candidate: unknown) => {
      if (typeof candidate === 'function') return candidate.name;
      if (candidate && typeof candidate === 'object' && 'name' in candidate) {
        const maybeName = (candidate as { name?: unknown }).name;
        return typeof maybeName === 'string' ? maybeName : null;
      }
      return null;
    };

    const startElement =
      document.querySelector('button[type="submit"]') ??
      document.querySelector('form') ??
      document.body;
    let root = getFiber(startElement);

    if (!root) {
      throw new Error('Unable to access React fiber for submission form');
    }

    while (root.return) {
      root = root.return;
    }

    const stack: ReactFiberNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;

      const name = getComponentName(node.elementType) ?? getComponentName(node.type);
      if (name === 'TurnstileWidget') {
        const onSuccess = node.memoizedProps?.onSuccess;
        if (typeof onSuccess !== 'function') {
          throw new Error('TurnstileWidget did not expose an onSuccess callback');
        }

        onSuccess(injectedToken);
        return;
      }

      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }

    throw new Error('Unable to find TurnstileWidget in the React tree');
  }, token);
}

async function waitForTurnstileWidgetToken(page: Page, timeout = 15_000) {
  const tokenHandle = await page
    .waitForFunction(
      () => {
        const responseFields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
        );

        for (const field of responseFields) {
          const value = field.value.trim();
          if (value) return value;
        }

        return null;
      },
      undefined,
      { timeout }
    )
    .catch(() => null);

  if (!tokenHandle) return null;

  const token = (await tokenHandle.jsonValue()) as string | null;
  return token?.trim() || null;
}

async function ensureTurnstileToken(page: Page, fallbackToken: string) {
  await page.waitForTimeout(250);

  const seedTurnstileInputs = async (tokenToSeed: string) => {
    await page.evaluate((token) => {
      const form = document.querySelector('form') ?? document.body;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      const setFieldValue = (field: HTMLInputElement | HTMLTextAreaElement) => {
        if (field instanceof HTMLTextAreaElement) {
          if (nativeTextAreaValueSetter) {
            nativeTextAreaValueSetter.call(field, token);
          } else {
            field.value = token;
          }
        } else {
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(field, token);
          } else {
            field.value = token;
          }
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };

      let turnstileTokenInput = document.querySelector<HTMLInputElement>(
        'input[name="turnstileToken"]'
      );
      if (!turnstileTokenInput) {
        turnstileTokenInput = document.createElement('input');
        turnstileTokenInput.type = 'hidden';
        turnstileTokenInput.name = 'turnstileToken';
        form.appendChild(turnstileTokenInput);
      }
      setFieldValue(turnstileTokenInput);

      let cfResponseField = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
      );
      if (!cfResponseField) {
        cfResponseField = document.createElement('input');
        cfResponseField.type = 'hidden';
        cfResponseField.name = 'cf-turnstile-response';
        form.appendChild(cfResponseField);
      }
      setFieldValue(cfResponseField);
    }, tokenToSeed);
  };

  const widgetToken = await waitForTurnstileWidgetToken(page);
  if (widgetToken) {
    try {
      await triggerTurnstileSuccess(page, widgetToken);
      await seedTurnstileInputs(widgetToken);
    } catch {
      await seedTurnstileInputs(widgetToken);
    }
    return 'widget';
  }

  const hasTurnstileScript =
    (await page.locator('script[src*="challenges.cloudflare.com/turnstile"]').count()) > 0;
  if (hasTurnstileScript && process.env.TURNSTILE_SECRET_KEY) {
    await seedTurnstileInputs(fallbackToken);
    return 'seeded';
  }

  try {
    await triggerTurnstileSuccess(page, fallbackToken);
    await seedTurnstileInputs(fallbackToken);
  } catch {
    await seedTurnstileInputs(fallbackToken);
  }

  return 'seeded';
}

test.describe('Submission happy path', () => {
  let supabase: ReturnType<typeof createClient>;
  let createdBrandName: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  });

  test.afterAll(async () => {
    if (!createdBrandName) return;
    await supabase.from('brand_submissions').delete().eq('brand_name', createdBrandName);
    await supabase.from('brands').delete().eq('name', createdBrandName);
  });

  test('submits a brand end-to-end and shows it in my submissions', async ({ userPage }) => {
    test.setTimeout(180_000);
    const timestamp = Date.now();
    const brandName = `[E2E-TEST] Happy Path ${timestamp}`;
    createdBrandName = brandName;
    const websiteUrl = `https://happy-path-${timestamp}.example.com`;
    const purchaseUrl = `https://shop.example.com/products/${timestamp}`;

    // 90s budget absorbs /submit cold-compile under parallel CI load (DEV-762).
    // global-setup warms the bundle, but a second worker hitting /submit simultaneously
    // may still pay a residual compile cost.
    await gotoSubmitWizard(userPage, { timeout: 90_000 });

    // UrlStep: fill official website, Instagram, and a purchase link BEFORE skipping.
    // (PR #132 moved social + purchase links from LinksStep to UrlStep.)
    await userPage.locator('#website-url').fill(websiteUrl);
    await userPage.locator('#url-instagram').fill('@e2e_happy_path');
    // Purchase link — native <select> followed by the url input in the same row
    await userPage.locator('select[role="combobox"]').first().selectOption('official');
    await userPage.locator('input[type="url"]').nth(1).fill(purchaseUrl);

    await userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true }).check();
    await userPage.getByRole('button', { name: manualEntryButtonName, exact: true }).click();

    await expect(userPage.getByLabel('品牌名稱', { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    await userPage.getByLabel('品牌名稱', { exact: true }).fill(brandName);
    await userPage
      .getByLabel('品牌描述', { exact: true })
      .fill('A handcrafted Taiwanese brand used to characterize the full submission wizard.');

    const logoUploadInput = userPage.locator('input[type="file"]');
    await Promise.all([
      userPage.waitForResponse(
        (response) => response.url().includes('/api/upload') && response.ok(),
        { timeout: 30_000 }
      ),
      logoUploadInput.setInputFiles({
        name: 'tiny-logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
      }),
    ]);

    await expect(userPage.getByAltText('上傳 1')).toBeVisible({ timeout: 10_000 });
    await userPage.getByRole('button', { name: nextButtonName, exact: true }).click();

    // TagsStep: select a product type — required by validation (productTypes.length > 0)
    await expect(userPage.getByText('產品類型', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await userPage.getByLabel('服飾鞋履').click();
    await userPage.getByRole('button', { name: nextButtonName, exact: true }).click();

    await expect(userPage.getByRole('heading', { name: '品牌資訊', exact: true })).toBeVisible({
      timeout: 5_000,
    });

    await userPage
      .getByRole('checkbox', {
        name: /我同意依據.*隱私政策.*收集和使用我的個人資料（PDPA 合規）/,
      })
      .check();

    await ensureTurnstileToken(userPage, `e2e-turnstile-${timestamp}`);

    await userPage.getByRole('button', { name: /提交品牌|Submit/i }).click();
    await userPage.waitForURL(/\/submit\/confirmation/i, { timeout: 120_000 }).catch(async (error) => {
      const alerts = await userPage.locator('[role="alert"]').allTextContents();
      const validationErrors = await userPage.locator('.text-red-600').allTextContents();
      const errorText = [...alerts, ...validationErrors]
        .map((message) => message.trim())
        .filter(Boolean)
        .join(' | ');
      throw new Error(
        `Timed out waiting for submit confirmation. Visible errors: ${errorText || 'none'}. ${error}`
      );
    });

    await expect(userPage).toHaveURL(/\/submit\/confirmation$/);
    await expect(userPage.getByRole('heading', { name: '感謝您！', exact: true })).toBeVisible();
    await expect(userPage.getByText('我們已收到您的品牌提交', { exact: true })).toBeVisible();

    await expect
      .poll(
        async () => {
          const { data, error } = await supabase
            .from('brand_submissions')
            .select('id, status')
            .eq('brand_name', brandName)
            .maybeSingle<{ id: string; status: string }>();

          if (error) throw error;
          return data?.status ?? null;
        },
        // Generous timeout: under parallel CI load the row read can lag (read-after-write
        // / pooled-connection consistency), which made this poll intermittently see null
        // (flaky). The UI confirmation + /my-submissions assertions already prove success;
        // this is a secondary DB check, so give it a wide 60s margin.
        { timeout: 60_000, intervals: [500, 1_000, 2_000, 5_000] }
      )
      .toBe('pending');

    await userPage.goto('/my-submissions');

    await expect(
      userPage.getByRole('heading', { name: /我的提交|My Submissions/i })
    ).toBeVisible({ timeout: 5_000 });

    const submissionCard = userPage
      .locator('div.rounded-xl.border')
      .filter({ has: userPage.getByText(brandName, { exact: true }) });

    await expect(submissionCard).toHaveCount(1, { timeout: 10_000 });
    await expect(submissionCard.first()).toBeVisible();
    await expect(submissionCard.first().getByText(brandName, { exact: true })).toBeVisible();
    await expect(submissionCard.first().getByText(/待審核|審核中|Pending|Under Review/i)).toBeVisible();
  });
});
