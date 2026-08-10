import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test.describe("Getting Started page deep", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/en/getting-started");
  });

  test("@smoke hero section renders", async ({ page }) => {
    // Substring match also hits the '<h2>How to explore Formoria</h2>' below the hero
    // (strict mode violation), so pin it to the eyebrow's exact text.
    await expect(
      page.getByText("Explore Formoria", { exact: true }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Find your next favorite brand",
      }),
    ).toBeVisible();
  });

  test("How to explore Formoria section renders with 4 step cards", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "How to explore Formoria" }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(
      page
        .getByRole("article")
        .filter({ hasText: "Start with what interests you" }),
    ).toBeVisible();
    await expect(
      page.getByRole("article").filter({ hasText: "Open a brand listing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("article").filter({ hasText: "Compare the details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("article").filter({ hasText: "Save brands for later" }),
    ).toBeVisible();
  });

  test("While you browse section renders with checklist", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "While you browse" }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(
      page.getByText(
        "Read the description and product details to understand what each brand offers.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Follow official links to learn more or shop directly from the brand.",
      ),
    ).toBeVisible();
  });

  test("optional brand owner section renders with benefit cards", async ({
    page,
  }) => {
    const heading = page.getByRole("heading", { name: "If you own a brand" });
    await expect(heading).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    const section = page.locator("section").filter({ has: heading });
    await expect(
      section.getByRole("article").filter({ hasText: "Claim Your Brand" }),
    ).toBeVisible();
    await expect(
      section.getByRole("article").filter({ hasText: "Manage Your Listing" }),
    ).toBeVisible();
    await expect(
      section.getByRole("article").filter({ hasText: "Track Performance" }),
    ).toBeVisible();
  });

  test("links to the FAQ and mission pages", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: "Read the FAQ" }),
    ).toHaveAttribute("href", /\/faq/);
    await expect(
      page.getByRole("link", { name: "Read our mission and vision" }),
    ).toHaveAttribute("href", /\/about#vision/);
  });

  test("CTA footer section renders and Browse link points to /brands", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Ready to explore Taiwanese brands?" }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    const browseLink = page.getByRole("link", { name: "Browse brands" }).last();
    await expect(browseLink).toBeVisible();
    const href = await browseLink.getAttribute("href");
    expect(href).toMatch(/\/brands/);
  });

  test("footer contains Getting Started link", async ({ page }) => {
    const footerLink = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Getting Started" });
    await expect(footerLink).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });
});
