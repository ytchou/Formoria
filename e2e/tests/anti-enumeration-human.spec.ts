import { test, expect, devices, type Page } from "@playwright/test";

import { BUDGET } from "../budgets";
import { getServiceClient } from "../helpers/seed";

/**
 * DEV-1551 task 18 / DEV-1285: the human regression matrix.
 *
 * THIS IS THE LAUNCH GATE. DEV-1285's guardrail is a challenge rate below 0.2%
 * for normal sessions, so every case here asserts ZERO challenges — not "few".
 * A single challenge in any of these journeys blocks enabling enforcement.
 *
 * Runs in the `adversarial` project, which is the only one that boots the
 * server with the limiter ENABLED. Running it with the limiter off would assert
 * nothing at all, which is the trap: these cases pass trivially in every other
 * project.
 *
 * Pacing note: `scripts/check-e2e-timeouts.mjs` bans hard sleeps, and rightly —
 * a sleeping test is a slow test that still proves nothing. "Human cadence"
 * here means real navigations with real render waits between them, which is
 * both honest and self-limiting.
 */

const CHALLENGE_TEXT = "快速驗證";

/**
 * Every place a challenge could have appeared, as a list of the URLs where one
 * did. The helper returns observations instead of asserting so each test can
 * make the assertion itself -- `playwright/expect-expect` only recognises a
 * literal `expect` in the test body, and a test whose only assertion hides in a
 * helper reads as passing when the helper is silently skipped.
 */
async function challengesDuring(
  page: Page,
  paths: string[],
): Promise<string[]> {
  const challenged: string[] = [];

  for (const path of paths) {
    await page.goto(path);
    // Waiting on the rendered page is the cadence: the same pause a person
    // takes to actually look at the thing they opened.
    await page
      .locator("main, h1")
      .first()
      .waitFor({ state: "visible", timeout: BUDGET.SERVER_RENDER })
      .catch(() => undefined);

    const onChallenge = page.url().includes("/challenge");
    const interstitial = await page.getByText(CHALLENGE_TEXT).count();
    const sawChallenge = onChallenge || interstitial > 0;
    challenged.push(...(sawChallenge ? [page.url()] : []));
  }

  return challenged;
}

async function approvedSlugs(limit: number): Promise<string[]> {
  const { data, error } = await getServiceClient()
    .from("brands")
    .select("slug")
    .eq("status", "approved")
    .limit(limit);
  if (error) throw new Error(`Could not read brand slugs: ${error.message}`);
  return (data ?? []).map((row) => row.slug as string);
}

/** The route list for one ordinary reader: the list, then some details. */
function readerPaths(slugs: string[], prefix = ""): string[] {
  return [`${prefix}/brands`, ...slugs.map((slug) => `${prefix}/brands/${slug}`)];
}

test.describe("anti-enumeration — human sessions draw zero challenges", () => {
  test("desktop Chrome, ordinary browsing", async ({ page }) => {
    const slugs = await approvedSlugs(3);

    const challenged = await challengesDuring(page, readerPaths(slugs));

    expect(challenged).toEqual([]);
  });

  for (const [label, descriptor] of [
    ["desktop Safari", devices["Desktop Safari"]],
    ["iPhone Safari", devices["iPhone 13"]],
    ["Android Chrome", devices["Pixel 5"]],
  ] as const) {
    test(`${label} draws no challenge`, async ({ browser }) => {
      const context = await browser.newContext({ ...descriptor });
      const page = await context.newPage();
      const slugs = await approvedSlugs(2);

      const challenged = await challengesDuring(page, readerPaths(slugs));
      await context.close();

      expect(challenged).toEqual([]);
    });
  }

  for (const [label, userAgent] of [
    [
      "LINE in-app browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.2.0",
    ],
    [
      "Instagram in-app browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113",
    ],
  ] as const) {
    test(`${label} draws no challenge`, async ({ browser }) => {
      // In-app browsers are the highest-risk false positive: an unusual UA on a
      // shared carrier IP is exactly the shape a naive heuristic blocks, and it
      // is how most people arrive from social.
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        userAgent,
      });
      const page = await context.newPage();
      const slugs = await approvedSlugs(2);

      const challenged = await challengesDuring(page, readerPaths(slugs));
      await context.close();

      expect(challenged).toEqual([]);
    });
  }

  for (const locale of ["zh-TW", "en"] as const) {
    test(`${locale} locale draws no challenge`, async ({ page }) => {
      // Locale variants must collapse to one route family; if they did not, a
      // bilingual reader would spend two budgets for one journey.
      const slugs = await approvedSlugs(2);

      const challenged = await challengesDuring(
        page,
        readerPaths(slugs, `/${locale}`),
      );

      expect(challenged).toEqual([]);
    });
  }

  test("a shared or VPN IP does not punish the second person on it", async ({
    browser,
  }) => {
    // Two independent visitors behind one address. The IP tier exists, but at
    // much higher thresholds precisely so an office or a carrier NAT is not a
    // block.
    const slugs = await approvedSlugs(2);
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);

    const results = await Promise.all(
      contexts.map(async (context) => {
        const page = await context.newPage();
        const challenged = await challengesDuring(page, readerPaths(slugs));
        await context.close();
        return challenged;
      }),
    );

    expect(results.flat()).toEqual([]);
  });

  test("multiple tabs in one session draw no challenge", async ({
    context,
  }) => {
    const slugs = await approvedSlugs(3);

    const results = await Promise.all(
      slugs.map(async (slug) => {
        const page = await context.newPage();
        const challenged = await challengesDuring(page, [`/brands/${slug}`]);
        await page.close();
        return challenged;
      }),
    );

    expect(results.flat()).toEqual([]);
  });

  test("a network change mid-session does not reset the visitor", async ({
    browser,
  }) => {
    // Wi-Fi to cellular changes the IP but keeps the cookie jar. The visitor
    // identity carries continuity; losing it here would make every commuter
    // look like a rotating client.
    const slugs = await approvedSlugs(2);
    const context = await browser.newContext();
    const page = await context.newPage();

    const before = await challengesDuring(page, ["/brands"]);
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.77" });
    const after = await challengesDuring(page, readerPaths(slugs));
    await context.close();

    expect([...before, ...after]).toEqual([]);
  });

  test("a normal search-and-filter journey draws no challenge", async ({
    page,
  }) => {
    // Filter params are part of the resourceId, so a reader narrowing a list
    // must not mint a distinct resource per click.
    const challenged = await challengesDuring(page, [
      "/brands",
      "/brands?category=beauty",
      "/brands?category=beauty&page=2",
      "/brands?sort=newest",
    ]);

    expect(challenged).toEqual([]);
  });

  test("a 20-brand journey at human cadence draws no challenge", async ({
    page,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);

    // The headline case. A genuinely engaged reader opening twenty distinct
    // brands is indistinguishable from a crawler by volume alone -- which is
    // why the thresholds are calibrated on behaviour, not on a count.
    const slugs = await approvedSlugs(20);
    test.skip(
      slugs.length < 20,
      "the launch gate needs 20 approved brands seeded",
    );

    const challenged = await challengesDuring(page, readerPaths(slugs));

    expect(challenged).toEqual([]);
  });
});
