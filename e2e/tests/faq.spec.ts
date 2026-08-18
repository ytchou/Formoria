import { BUDGET, POLL } from "../budgets";
import { test, expect } from "../fixtures/auth";
import zhTW from "../../messages/zh-TW.json";

/** Every `faq.items` entry renders as one <details>; see the count assertion below. */
const EXPECTED_FAQ_ITEMS = Object.keys(zhTW.faq.items).length;

/**
 * FAQ page
 *
 * Journey: Anonymous visitor lands on /faq (zh-TW, the default locale path),
 * sees both section headings and every translated expandable item; hash links scroll
 * the correct section into view; the #claim item auto-opens via the
 * OpenTargetDetails client component.
 *
 * The 品牌主專區 section collapsed to a single interest-collection item while
 * owner self-serve is gated off (DEV-1261). It keeps id="claim", so the
 * legacy /faq#claim deep link still lands on an answer — see the last test.
 *
 * Actor: anonPage (no authentication, no DB state)
 * Seed: none
 */
test.describe("FAQ page", () => {
  test("@smoke renders two section headings and every translated details element", async ({
    anonPage,
  }) => {
    // /faq is the zh-TW canonical URL (localePrefix: 'as-needed', defaultLocale: 'zh-TW')
    const resp = await anonPage.goto("/faq", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // Both section-level h2 headings must be present
    await expect(
      anonPage.getByRole("heading", { name: "一般問題", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(
      anonPage.getByRole("heading", { name: "品牌主專區", level: 2 }),
    ).toBeVisible({
      timeout: BUDGET.RENDERED,
    });

    // Derived from the message catalogue rather than hardcoded. This was a bare
    // `toHaveCount(14)` whose own comment admitted that adding a FAQ entry turns
    // the spec red — a test that has to be edited every time the content it
    // covers changes trains people to edit tests rather than read them
    // (DEV-1414).
    //
    // The coupling is deliberate: every entry under `faq.items` is expected to
    // render as a <details>, so a mismatch means either an entry the page never
    // renders or a rendered item with no copy. Both are worth failing on.
    await expect(anonPage.locator("details")).toHaveCount(EXPECTED_FAQ_ITEMS, {
      timeout: BUDGET.RENDERED,
    });
    const listingDetails = anonPage.locator("details").filter({
      hasText: "收錄品牌和 Formoria 選物有什麼不同？",
    });
    await listingDetails.locator("summary").click();
    await expect(
      listingDetails.getByText(
        "「收錄品牌」代表品牌符合目錄收錄規則，可以在搜尋資料中找到；這不等於 Formoria 背書、選物、認證或排名。「Formoria 選物」則是 Formoria 基於特定情境、用途、偏好或編輯觀點刻意挑選的產品或內容，會另外標示，並說明產品是什麼、可以在哪裡向品牌訂購。",
        { exact: true },
      ),
    ).toBeVisible();

    const purchaseDetails = anonPage.locator("details").filter({
      hasText: "可以直接在 Formoria 購買嗎？",
    });
    await purchaseDetails.locator("summary").click();
    await expect(
      purchaseDetails.getByText(
        "不行。Formoria 負責靈感、選擇、脈絡與前往外部通路的路徑，不接受訂單或處理結帳。價格、規格選項、庫存、結帳、出貨與售後服務由品牌或零售通路負責。",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("English FAQ explains listing versus selection and the purchase boundary", async ({
    anonPage,
  }) => {
    await anonPage.goto("/en/faq", { timeout: BUDGET.GATED_UI });

    const listingDetails = anonPage.locator("details").filter({
      hasText:
        "What is the difference between a listed brand and a Formoria Selection?",
    });
    await expect(listingDetails.locator("summary")).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await listingDetails.locator("summary").click();
    await expect(
      listingDetails.getByText(
        "A listed brand meets the directory rules and can be found in the searchable record; listing is not Formoria endorsement, selection, certification, or ranking. A Formoria Selection is a product or content item deliberately chosen for a situation, use, preference, or editorial argument, labelled separately and described for what it is and where to order it from the brand.",
        { exact: true },
      ),
    ).toBeVisible();

    const purchaseDetails = anonPage.locator("details").filter({
      hasText: "Can I purchase through Formoria?",
    });
    await purchaseDetails.locator("summary").click();
    await expect(
      purchaseDetails.getByText(
        "No. Formoria owns inspiration, selection, context, and the outbound route; it does not accept orders or process checkout. Brands or retailers remain responsible for price, variants, inventory, checkout, fulfilment, and after-sales service.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("#for-owners anchor scrolls the section into viewport", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#for-owners", {
      timeout: BUDGET.GATED_UI,
    });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // The <section id="for-owners"> must be within the viewport after hash navigation
    await expect(anonPage.locator("#for-owners")).toBeInViewport({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  test("#claim details auto-opens via OpenTargetDetails on hash navigation", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#claim", {
      timeout: BUDGET.GATED_UI,
    });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // OpenTargetDetails runs a useEffect that sets <details id="claim">.open = true.
    // Poll until hydration completes and the attribute is set.
    await expect(async () => {
      const isOpen = await anonPage.evaluate(() => {
        const el = document.getElementById("claim");
        return el ? el.open : false;
      });
      expect(isOpen).toBe(true);
    }).toPass(POLL.UI);
  });
});
