// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh-TW.json";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import {
  BrandHeader,
  BrandHeroFacts,
  hasBrandHeroFacts,
} from "../brand-header";

const T = zh.brandDetail;

function buildBrand(
  overrides: Partial<PublicBrandDetail> = {},
): PublicBrandDetail {
  return {
    id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
    name: "Harbor Form",
    slug: "harbor-form",
    categoryLabel: "生活用品",
    foundingYear: 2015,
    city: "taipei",
    ...overrides,
  } as unknown as PublicBrandDetail;
}

function renderZh(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("BrandHeader", () => {
  it("puts city and founding year in the metadata line by default", () => {
    renderZh(<BrandHeader brand={buildBrand()} cityLabel="台北" />);

    expect(screen.getByText("生活用品 · 台北 · 2015 年創立")).toBeInTheDocument();
  });

  it("leaves city and year out of the metadata line when the colophon carries them", () => {
    renderZh(
      <BrandHeader brand={buildBrand()} cityLabel="台北" omitProvenance />,
    );

    expect(screen.getByText("生活用品")).toHaveClass("type-metadata");
    expect(screen.queryByText(/台北/)).toBeNull();
    expect(screen.queryByText(/2015/)).toBeNull();
  });
});

describe("BrandHeroFacts", () => {
  it("sets city and founding year as a labelled colophon", () => {
    renderZh(
      <BrandHeroFacts
        cityLabel="台北"
        foundingYear={2015}
        selectedCount={0}
        stockistCount={0}
      />,
    );

    expect(screen.getByText(T.colophon.city).tagName).toBe("DT");
    expect(screen.getByText("台北")).toHaveClass("type-page-title");
    expect(screen.getByText(T.colophon.founded).tagName).toBe("DT");
    expect(screen.getByText("2015")).toHaveClass("type-page-title");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders only the colophon facts that exist", () => {
    renderZh(
      <BrandHeroFacts
        cityLabel={null}
        foundingYear={2015}
        selectedCount={0}
        stockistCount={0}
      />,
    );

    expect(screen.queryByText(T.colophon.city)).toBeNull();
    expect(screen.getByText("2015")).toBeInTheDocument();
  });

  it("links to the sections with counts, and only those", () => {
    renderZh(
      <BrandHeroFacts
        cityLabel={null}
        foundingYear={null}
        selectedCount={3}
        stockistCount={0}
      />,
    );

    const nav = screen.getByRole("navigation", { name: T.tabNav.overview });
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Formoria 選物 · 3 件" }),
    ).toHaveAttribute("href", "#selected-products");
    expect(screen.queryByRole("link", { name: /實體通路/ })).toBeNull();
  });

  it("pluralizes the EN jump rows", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandHeroFacts
          cityLabel={null}
          foundingYear={null}
          selectedCount={1}
          stockistCount={4}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("link", { name: "1 product selected by Formoria" }),
    ).toHaveAttribute("href", "#selected-products");
    expect(screen.getByRole("link", { name: "4 stockists" })).toHaveAttribute(
      "href",
      "#where-to-buy",
    );
  });

  it("renders nothing, and reports nothing, when there are no facts", () => {
    const props = {
      cityLabel: null,
      foundingYear: null,
      selectedCount: 0,
      stockistCount: 0,
    };
    const { container } = renderZh(<BrandHeroFacts {...props} />);

    expect(container).toBeEmptyDOMElement();
    expect(hasBrandHeroFacts(props)).toBe(false);
    expect(hasBrandHeroFacts({ ...props, stockistCount: 1 })).toBe(true);
    expect(hasBrandHeroFacts({ ...props, foundingYear: 1998 })).toBe(true);
  });
});
