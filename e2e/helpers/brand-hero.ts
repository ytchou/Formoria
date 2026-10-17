import type { Locator, Page } from "@playwright/test";

/**
 * The metadata line under a brand's h1 (BrandHeader, `data-brand-meta`). It
 * shares a wrapper with the makes line (`data-brand-makes`), so it is matched
 * by attribute, not by its position next to the h1. When the brand has a story
 * it carries only the category; city and founding year move to the colophon
 * under the story (BD-22).
 */
export function heroMetaLine(page: Page): Locator {
  return page.getByRole("main").locator("[data-brand-meta]");
}

/** The founding fact under the story, e.g. 「2020 年創立」 (BrandColophon). */
export function brandColophon(page: Page): Locator {
  return page.getByRole("main").locator("[data-brand-colophon]");
}
