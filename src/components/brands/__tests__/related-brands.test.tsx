/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PublicBrandCard } from "@/lib/brands/contracts";

// Real catalogue, real ICU formatting: the header copy is what is under test.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../messages/zh-TW.json")).default;
  type TranslatorOptions = Parameters<typeof createTranslator>[0];

  return {
    getTranslations: async ({ namespace }: { namespace: string }) =>
      createTranslator({
        locale: "zh-TW",
        messages,
        namespace,
      } as TranslatorOptions),
  };
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header copy is under test here; the cards and the viewport tracker are
// covered by their own tests.
vi.mock("../brand-card", () => ({
  BrandCard: ({
    brand,
    hideCategory,
  }: {
    brand: PublicBrandCard;
    hideCategory?: boolean;
  }) => (
    <article data-hide-category={hideCategory ? "true" : "false"}>
      {brand.name}
    </article>
  ),
}));

vi.mock("../related-brands-tracker", () => ({
  RelatedBrandsTracker: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const { RelatedBrands } = await import("../related-brands");

const brand = { id: "brand-2", name: "木匠工坊" } as PublicBrandCard;

async function renderSection() {
  const section = await RelatedBrands({
    locale: "zh-TW",
    brands: [brand, { id: "brand-3", name: "山間器物" } as PublicBrandCard],
    category: "home",
    categoryName: "居家生活",
    count: 63,
    currentBrandSlug: "shanjian",
  });
  if (!section) throw new Error("RelatedBrands rendered nothing");
  return render(section);
}

describe("RelatedBrands header", () => {
  // One count only — the link's category total. A second "others" count in
  // the subtext contradicted it.
  it("names the category total in the link and no count in the subtext", async () => {
    await renderSection();

    expect(
      screen.getByRole("link", { name: "看全部 63 個居家生活品牌" }),
    ).toBeInTheDocument();
    const subtext = screen.getByText("同樣收錄在居家生活的品牌");
    expect(subtext.textContent).not.toMatch(/\d/);
  });
});

describe("RelatedBrands cards", () => {
  // The heading already names the category, so each card shows city only.
  it("hides the category on every card", async () => {
    const { container } = await renderSection();

    const cards = container.querySelectorAll("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toHaveAttribute("data-hide-category", "true");
    }
  });

  // Below `sm` the cards scroll sideways in one snap row instead of stacking
  // ~1,100px tall; from `sm` the shared card grid columns take over.
  it("lays the cards out as a snap row below sm, the card grid from sm", async () => {
    const { container } = await renderSection();

    const row = container.querySelector("article")?.parentElement;
    expect(row).toHaveClass(
      "max-sm:grid-flow-col",
      "max-sm:auto-cols-[85%]",
      "max-sm:overflow-x-auto",
      "max-sm:snap-x",
      "max-sm:snap-mandatory",
      "*:snap-start",
      "gap-gutter",
      "sm:grid-cols-2",
      "lg:grid-cols-4",
    );
  });
});
