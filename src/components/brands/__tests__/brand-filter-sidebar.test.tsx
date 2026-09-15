/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-TW.json";
import { VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";

const { replace, push, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/brands",
  useRouter: () => ({ push, replace }),
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  usePathname: () => "/brands",
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/analytics", () => ({
  trackCategoryFilterApplied: vi.fn(),
  trackFilterCleared: vi.fn(),
  trackSubcategoryFilterApplied: vi.fn(),
}));

const { BrandFilterDrawer, BrandFilterSidebar } =
  await import("../brand-filter-sidebar");

type TestLocale = "zh-TW" | "en";

function messagesFor(locale: TestLocale) {
  return locale === "zh-TW" ? zhMessages : enMessages;
}

function renderSidebar(
  props: Partial<React.ComponentProps<typeof BrandFilterSidebar>> = {},
  query = "",
  locale: TestLocale = "zh-TW",
) {
  searchParams.current = new URLSearchParams(query);
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)}>
      <BrandFilterSidebar
        locale={locale}
        activeCategory={null}
        allLabel={messagesFor(locale).common.all}
        totalCount={24}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("BrandFilterSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders category links for all visible L1 categories", () => {
    renderSidebar();

    // "All" link
    const allLink = screen.getByRole("link", { name: "全部" });
    expect(allLink).toHaveAttribute("aria-current", "page");
    expect(allLink).toHaveAttribute("href", "/brands");

    // Each visible L1 category has a link
    for (const category of VISIBLE_L1_CATEGORIES) {
      expect(
        screen.getByRole("link", { name: category.nameZh }),
      ).toBeInTheDocument();
    }
  });

  it("marks the active category link with aria-current", () => {
    renderSidebar({ activeCategory: "fashion" });

    const fashionLink = screen.getByRole("link", {
      name: VISIBLE_L1_CATEGORIES.find((c) => c.slug === "fashion")!.nameZh,
    });
    expect(fashionLink).toHaveAttribute("aria-current", "page");

    const allLink = screen.getByRole("link", { name: "全部" });
    expect(allLink).not.toHaveAttribute("aria-current");
  });

  it("filter drawer renders and opens", () => {
    searchParams.current = new URLSearchParams();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BrandFilterDrawer
          locale="en"
          activeCategory={null}
          allLabel="All"
          totalCount={24}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

    const body = document.querySelector('[data-slot="sheet-body"]');
    expect(body).not.toBeNull();
  });
});
