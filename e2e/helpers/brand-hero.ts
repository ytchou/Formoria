import type { Locator, Page } from "@playwright/test";

/**
 * The one metadata line set directly under a brand's h1 (BrandHeader). When
 * the brand has a story it carries only the category; city and founding year
 * move to the colophon under the story (BD-22).
 */
export function heroMetaLine(page: Page): Locator {
  return page.getByRole("main").locator("div:has(> h1) + p");
}

/** The founding fact under the story, e.g. 「2020 年創立」 (BrandColophon). */
export function brandColophon(page: Page): Locator {
  return page.getByRole("main").locator("[data-brand-colophon]");
}
