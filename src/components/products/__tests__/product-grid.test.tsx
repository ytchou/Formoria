// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { ProductGrid } from "../product-grid";

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

function makeProduct(i: number): CatalogProduct {
  return {
    id: `prod-${i}`,
    key: `product-${i}`,
    nameZh: `商品${i}`,
    nameEn: `Product ${i}`,
    category: "bags-accessories",
    subcategory: "handbags",
    material: ["leather"],
    createdAt: "2026-01-01",
    imageUrl: `/i/p${i}.jpg`,
    officialUrl: "https://example.com/product",
    brandSlug: "test-brand",
    brandName: "Test Brand",
    productDescriptionZh: "說明",
    productDescriptionEn: "Description",
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
}

describe("ProductGrid", () => {
  it("loads the widest first row eagerly and only the first image at high priority", () => {
    const products = Array.from({ length: 7 }, (_, i) => makeProduct(i));
    render(<ProductGrid products={products} locale="zh-TW" />);

    const imgs = products.map((p) =>
      screen.getByRole("img", { name: p.nameZh }),
    );

    imgs.slice(0, 5).forEach((img) => {
      expect(img).toHaveAttribute("loading", "eager");
    });
    imgs.slice(5).forEach((img) => {
      expect(img).not.toHaveAttribute("loading", "eager");
    });

    expect(imgs[0]).toHaveAttribute("fetchpriority", "high");
    imgs.slice(1).forEach((img) => {
      expect(img).not.toHaveAttribute("fetchpriority");
    });
  });
});
