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
  BrandCard: ({ brand }: { brand: PublicBrandCard }) => (
    <article>{brand.name}</article>
  ),
}));

vi.mock("../related-brands-tracker", () => ({
  RelatedBrandsTracker: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const { RelatedBrands } = await import("../related-brands");

const brand = { id: "brand-2", name: "木匠工坊" } as PublicBrandCard;

describe("RelatedBrands header", () => {
  it("names the category total in the link and the others in the subtext", async () => {
    const section = await RelatedBrands({
      locale: "zh-TW",
      brands: [brand],
      category: "home",
      categoryName: "居家生活",
      count: 63,
      currentBrandSlug: "shanjian",
    });
    if (!section) throw new Error("RelatedBrands rendered nothing");
    render(section);

    expect(
      screen.getByRole("link", { name: "看全部 63 個居家生活品牌" }),
    ).toBeInTheDocument();
    expect(screen.getByText("居家生活還收錄了 62 個品牌")).toBeInTheDocument();
  });
});
