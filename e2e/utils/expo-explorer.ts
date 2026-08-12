import type { Locator } from "@playwright/test";

export type LinkedExhibitorSubject = {
  booth: string;
  href: string;
  name: string;
  row: Locator;
  link: Locator;
};

/** Resolve a real linked row from the rendered explorer without pinning roster data. */
export async function resolveLinkedExhibitor(
  explorer: Locator,
  locale: "en" | "zh-TW",
): Promise<LinkedExhibitorSubject | null> {
  const brandPrefix = locale === "en" ? "/en/brands/" : "/brands/";
  const row = explorer
    .locator(`li:has(a[href^="${brandPrefix}"]):has(span.tabular-nums)`)
    .first();
  if ((await row.count()) === 0) return null;

  const link = row.locator(`a[href^="${brandPrefix}"]`).first();
  const booth = (
    (await row.locator("span.tabular-nums").first().textContent()) ?? ""
  ).trim();
  const href = (await link.getAttribute("href")) ?? "";
  const name = ((await link.textContent()) ?? "").trim();

  if (!booth || !href.startsWith(brandPrefix) || !name) {
    throw new Error(
      "Creative Expo has no linked exhibitor row with a booth, href, and name",
    );
  }

  return { booth, href, name, row, link };
}
