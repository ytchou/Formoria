import type { Locator, Page } from "@playwright/test";

/**
 * The one metadata line set directly under a brand's h1 (BrandHeader). When
 * the hero colophon is shown it carries only the category; city and founding
 * year move to the colophon (BD2-31).
 */
export function heroMetaLine(page: Page): Locator {
  return page.getByRole("main").locator("div:has(> h1) + p");
}

/** The colophon value (`dd`) under the given label, e.g. 創立 / Founded. */
export function colophonValue(page: Page, label: string): Locator {
  return page
    .getByRole("main")
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");
}
