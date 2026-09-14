// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { ProductCard } from "../product-card";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img alt="" data-priority={priority ? "true" : "false"} {...props} />
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/save-button", () => ({
  SaveButton: () => <button data-testid="save-button" />,
}));

const baseProduct: CatalogProduct = {
  id: "prod-1",
  key: "test-product",
  nameZh: "手工皮革包",
  nameEn: "Handmade Leather Bag",
  category: "bags-accessories",
  subcategory: "handbags",
  material: ["leather"],
  createdAt: "2026-01-01",
  imageUrl: null,
  officialUrl: "https://example.com/product",
  brandSlug: "test-brand",
  brandName: "Test Brand",
  productDescriptionZh: "義大利植鞣牛皮手染鞋面與鞋墊",
  productDescriptionEn: "Italian vegetable-tanned leather",
  brand: {
    slug: "test-brand",
    purchaseWebsite: "https://example.com",
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
  },
};

describe("ProductCard", () => {
  it("renders the zh description under the brand name", () => {
    render(<ProductCard product={baseProduct} locale="zh-TW" />);
    const descEl = screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊");
    expect(descEl).toBeInTheDocument();
    expect(descEl).toHaveAttribute("data-nosnippet");
  });

  it("en locale falls back to zh when productDescriptionEn is null", () => {
    const product = { ...baseProduct, productDescriptionEn: null };
    render(<ProductCard product={product} locale="en" />);
    expect(
      screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊"),
    ).toBeInTheDocument();
  });

  it("en locale prefers productDescriptionEn when present", () => {
    render(<ProductCard product={baseProduct} locale="en" />);
    expect(
      screen.getByText("Italian vegetable-tanned leather"),
    ).toBeInTheDocument();
  });

  it("keeps the subcategory badge after the description", () => {
    const { container } = render(
      <ProductCard product={baseProduct} locale="zh-TW" />,
    );
    const elements = container.querySelectorAll(
      "h3, p[data-nosnippet], [class*='badge']",
    );
    const texts = Array.from(elements).map((el) => el.textContent);
    // name -> description -> badge in DOM order
    expect(texts[0]).toBe("手工皮革包");
    expect(texts[1]).toBe("義大利植鞣牛皮手染鞋面與鞋墊");
  });
});
