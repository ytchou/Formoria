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

  it("renders data-brand-slug attribute", () => {
    const { container } = render(
      <ProductCard product={baseProduct} locale="zh-TW" />,
    );
    const li = container.querySelector("li");
    expect(li).toHaveAttribute("data-brand-slug", "test-brand");
  });

  it("renders data-product-key attribute", () => {
    const { container } = render(
      <ProductCard product={baseProduct} locale="zh-TW" />,
    );
    const li = container.querySelector("li");
    expect(li).toHaveAttribute("data-product-key", "test-product");
  });

  it("orders brand, name, then reason", () => {
    const { container } = render(
      <ProductCard product={baseProduct} locale="zh-TW" />,
    );
    const texts = Array.from(
      container.querySelectorAll("a p, a h3"),
    ).map((el) => el.textContent);
    expect(texts).toEqual([
      "Test Brand",
      "手工皮革包",
      "義大利植鞣牛皮手染鞋面與鞋墊",
    ]);
    expect(
      container.querySelector("a p:last-of-type")?.hasAttribute(
        "data-nosnippet",
      ),
    ).toBe(true);
  });

  it("renders no subcategory badge", () => {
    render(<ProductCard product={baseProduct} locale="zh-TW" />);
    expect(screen.queryByText("手提包")).not.toBeInTheDocument();
    expect(screen.queryByText("handbags")).not.toBeInTheDocument();
  });

  it("renders frameless", () => {
    const { container } = render(
      <ProductCard product={baseProduct} locale="zh-TW" />,
    );
    expect(container.querySelector("li")?.className ?? "").not.toMatch(
      /\bborder\b/,
    );
  });

  it("clamps name and reason to one line without slicing", () => {
    render(<ProductCard product={baseProduct} locale="zh-TW" />);
    const name = screen.getByRole("heading", { level: 3 });
    const reason = screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊");
    expect(name).toHaveClass("line-clamp-1");
    expect(name.textContent).toBe("手工皮革包");
    expect(reason).toHaveClass("line-clamp-1");
    expect(reason.textContent).toBe("義大利植鞣牛皮手染鞋面與鞋墊");
  });

  it("uses the caller's image sizes", () => {
    const product = {
      ...baseProduct,
      imageUrl: "/i/p.jpg",
    };
    render(
      <ProductCard product={product} locale="zh-TW" imageSizes="123px" />,
    );
    expect(screen.getByRole("img", { name: "手工皮革包" })).toHaveAttribute(
      "sizes",
      "123px",
    );
  });
});
