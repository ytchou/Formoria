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

  it("clamps name to two lines and reason to one without slicing", () => {
    render(<ProductCard product={baseProduct} locale="zh-TW" />);
    const name = screen.getByRole("heading", { level: 3 });
    const reason = screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊");
    expect(name).toHaveClass("line-clamp-2");
    expect(name.textContent).toBe("手工皮革包");
    expect(reason).toHaveClass("line-clamp-1");
    expect(reason.textContent).toBe("義大利植鞣牛皮手染鞋面與鞋墊");
  });

  it("hides the reason below sm", () => {
    render(<ProductCard product={baseProduct} locale="zh-TW" />);
    const reason = screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊");
    expect(reason).toHaveClass("max-sm:hidden", "line-clamp-1");
  });

  describe("lang on locale fallback", () => {
    it("marks the zh description as zh-Hant-TW when en falls back", () => {
      const product = { ...baseProduct, productDescriptionEn: null };
      render(<ProductCard product={product} locale="en" />);
      expect(screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊")).toHaveAttribute(
        "lang",
        "zh-Hant-TW",
      );
    });

    it("treats an empty productDescriptionEn as missing", () => {
      const product = { ...baseProduct, productDescriptionEn: "" };
      render(<ProductCard product={product} locale="en" />);
      expect(screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊")).toHaveAttribute(
        "lang",
        "zh-Hant-TW",
      );
    });

    it("sets no lang on the description when en text is present", () => {
      render(<ProductCard product={baseProduct} locale="en" />);
      expect(
        screen.getByText("Italian vegetable-tanned leather"),
      ).not.toHaveAttribute("lang");
    });

    it("sets no lang on the description on zh-TW", () => {
      render(<ProductCard product={baseProduct} locale="zh-TW" />);
      expect(
        screen.getByText("義大利植鞣牛皮手染鞋面與鞋墊"),
      ).not.toHaveAttribute("lang");
    });

    it("marks the zh name as zh-Hant-TW when en falls back", () => {
      const product = { ...baseProduct, nameEn: null };
      render(<ProductCard product={product} locale="en" />);
      const name = screen.getByRole("heading", { level: 3 });
      expect(name.textContent).toBe("手工皮革包");
      expect(name).toHaveAttribute("lang", "zh-Hant-TW");
    });

    it("sets no lang on the name when en text is present", () => {
      render(<ProductCard product={baseProduct} locale="en" />);
      const name = screen.getByRole("heading", { level: 3 });
      expect(name.textContent).toBe("Handmade Leather Bag");
      expect(name).not.toHaveAttribute("lang");
    });

    it("sets no lang on the name on zh-TW", () => {
      render(<ProductCard product={baseProduct} locale="zh-TW" />);
      expect(screen.getByRole("heading", { level: 3 })).not.toHaveAttribute(
        "lang",
      );
    });
  });

  describe("image priority", () => {
    const withImage = { ...baseProduct, imageUrl: "/i/p.jpg" };

    it('loads eagerly at high fetch priority for imagePriority="high"', () => {
      render(
        <ProductCard product={withImage} locale="zh-TW" imagePriority="high" />,
      );
      const img = screen.getByRole("img", { name: "手工皮革包" });
      expect(img).toHaveAttribute("loading", "eager");
      expect(img).toHaveAttribute("fetchpriority", "high");
    });

    it('loads eagerly at default fetch priority for imagePriority="eager"', () => {
      render(
        <ProductCard product={withImage} locale="zh-TW" imagePriority="eager" />,
      );
      const img = screen.getByRole("img", { name: "手工皮革包" });
      expect(img).toHaveAttribute("loading", "eager");
      expect(img).not.toHaveAttribute("fetchpriority");
    });

    it("keeps next/image's lazy default when imagePriority is omitted", () => {
      render(<ProductCard product={withImage} locale="zh-TW" />);
      const img = screen.getByRole("img", { name: "手工皮革包" });
      // next/image is mocked here, so the lazy default itself is not rendered;
      // the contract is that the card passes no eager override.
      expect(img).not.toHaveAttribute("loading", "eager");
      expect(img).not.toHaveAttribute("fetchpriority");
    });
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
