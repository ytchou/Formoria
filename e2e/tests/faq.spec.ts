import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import zhTW from "../../messages/zh-TW.json";

/** Every `faq.items` entry renders as one <details>; see the count assertion below. */
const EXPECTED_FAQ_ITEMS = Object.keys(zhTW.faq.items).length;

/**
 * FAQ page
 *
 * Journey: Anonymous visitor lands on /faq (zh-TW, the default locale path),
 * sees the three section headings (收錄與選物 / 推薦與審核 / 購買與其他) and
 * every translated expandable item; the #review hash link scrolls its section
 * into view. The 台灣製造 answer names the MIT 微笑標章, says listing review
 * does not judge origin, and never says 認證; the categories answer lists the six visible
 * categories, derived from the taxonomy rather than hard-coded (DEV-1957).
 *
 * DEV-1570 removed the 品牌主專區 section and the id="claim" answer with the
 * claim flow. The legacy /faq#claim deep link is still asserted to land on the
 * page rather than error — see the last test.
 *
 * Actor: anonPage (no authentication, no DB state)
 * Seed: none
 */
test.describe("FAQ page", () => {
  test("@smoke renders the section heading and every translated details element", async ({
    anonPage,
  }) => {
    // /faq is the zh-TW canonical URL (localePrefix: 'as-needed', defaultLocale: 'zh-TW')
    const resp = await anonPage.goto("/faq", { timeout: BUDGET.GATED_UI });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // The three section-level h2 headings must be present. 一般問題 was the
    // single bucket they replaced (DEV-1957), and 品牌主專區 went with the
    // claim flow (DEV-1570), so both absences are asserted too — an orphaned
    // heading would mean a section came back without its answers.
    for (const name of ["收錄與選物", "推薦與審核", "購買與其他"]) {
      await expect(
        anonPage.getByRole("heading", { name, level: 2 }),
      ).toBeVisible({
        timeout: BUDGET.SERVER_RENDER,
      });
    }
    await expect(
      anonPage.getByRole("heading", { name: "一般問題", level: 2 }),
    ).toHaveCount(0);
    await expect(
      anonPage.getByRole("heading", { name: "品牌主專區", level: 2 }),
    ).toHaveCount(0);

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
        "「收錄品牌」是符合收錄規則、在品牌目錄裡找得到的品牌，不代表 Formoria 推薦、認證或排名。「Formoria 選物」是編輯為某個情境刻意挑選的商品，會另外標示，並寫明挑選的理由。",
        { exact: true },
      ),
    ).toBeVisible();

    const purchaseDetails = anonPage.locator("details").filter({
      hasText: "可以直接在 Formoria 購買嗎？",
    });
    await purchaseDetails.locator("summary").click();
    await expect(
      purchaseDetails.getByText(
        "不行。Formoria 不接單，也不處理結帳。價格、規格、庫存、出貨和售後都由品牌或販售的店家負責；我們負責幫你找到它，再把你交到品牌手上。",
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
        "A listed brand meets the listing rules and can be found in the directory. Listing does not mean Formoria recommends, certifies, or ranks it. A Formoria Selection is a product our editors chose on purpose for a particular situation. It is labeled separately, and the reason for choosing it is written out.",
        { exact: true },
      ),
    ).toBeVisible();

    const purchaseDetails = anonPage.locator("details").filter({
      hasText: "Can I buy through Formoria?",
    });
    await purchaseDetails.locator("summary").click();
    await expect(
      purchaseDetails.getByText(
        "No. Formoria does not take orders or handle checkout. Price, variants, stock, shipping, and after-sales service are up to the brand or the store selling it. Our job is to help you find it, then hand you to the brand.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("#review anchor scrolls the section into viewport", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#review", {
      timeout: BUDGET.GATED_UI,
    });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }

    // The <section id="review"> sits below the first section, so being in the
    // viewport after hash navigation means the browser scrolled to it.
    await expect(anonPage.locator("#review")).toBeInViewport({
      timeout: BUDGET.INTERACTIVE,
    });
  });

  // The legacy deep link, kept as a regression case rather than deleted:
  // /faq#claim was published while the claim flow existed, so it is still in
  // the wild. DEV-1570 removed the answer it pointed at, and an unknown hash
  // must degrade to the plain FAQ page — not a 404 and not an empty render.
  test("legacy /faq#claim deep link still lands on the FAQ page", async ({
    anonPage,
  }) => {
    const resp = await anonPage.goto("/faq#claim", {
      timeout: BUDGET.GATED_UI,
    });
    if (resp?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping");
      return;
    }
    expect(resp?.status()).toBeLessThan(400);

    await expect(
      anonPage.getByRole("heading", { name: "收錄與選物", level: 2 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(anonPage.locator("#claim")).toHaveCount(0);
    await expect(anonPage.locator("details")).toHaveCount(EXPECTED_FAQ_ITEMS, {
      timeout: BUDGET.RENDERED,
    });
  });

  // The badge used to be named two ways (標章 / MIT 認證) across two answers.
  // One answer names the registry and says listing review does not judge
  // product origin (the 品牌聲明 sentence was cut in DEV-1994), and never says
  // 認證 — scoped to this <details>, because the
  // listing-versus-selection answer legitimately says 不代表…認證.
  test("台灣製造 answer names the MIT registry and the listing-review limit, not 認證", async ({
    anonPage,
  }) => {
    await anonPage.goto("/faq", { timeout: BUDGET.GATED_UI });

    const badgeDetails = anonPage.locator("details").filter({
      hasText: "商品上的「台灣製造」代表什麼？",
    });
    await expect(badgeDetails.locator("summary")).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await badgeDetails.locator("summary").click();
    await expect(badgeDetails).toContainText("「MIT 微笑標章」");
    await expect(badgeDetails).toContainText("不判斷商品產地");
    await expect(badgeDetails).not.toContainText("認證");
  });

  // The answer once claimed twelve categories while the site showed six. It is
  // now built from the visible taxonomy, so it must list exactly those six and
  // none of the deferred ones.
  test("categories answer lists exactly the six visible categories", async ({
    anonPage,
  }) => {
    await anonPage.goto("/faq", { timeout: BUDGET.GATED_UI });

    const categoriesDetails = anonPage.locator("details").filter({
      hasText: "Formoria 收錄哪些分類？",
    });
    await expect(categoriesDetails.locator("summary")).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await categoriesDetails.locator("summary").click();
    await expect(categoriesDetails).toContainText(
      "服飾鞋履、包袋配件、飾品珠寶、美妝保養、居家生活、文具設計",
    );
    await expect(categoriesDetails).toContainText("6 個");
    await expect(categoriesDetails).not.toContainText("食品飲料");
  });
});
