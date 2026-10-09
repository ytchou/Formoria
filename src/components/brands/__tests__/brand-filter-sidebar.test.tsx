/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-TW.json";

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
        activeCategory={null}
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

  it("renders no category links: /brands picks the L1 from its chip row (R2-10)", () => {
    renderSidebar({
      subcategoryOptions: [
        { slug: "candles", label: "香氛蠟燭", count: 5, category: "home" },
      ],
    });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /香氛蠟燭/ })).toBeInTheDocument();
  });

  it("filter drawer renders and opens", () => {
    searchParams.current = new URLSearchParams();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BrandFilterDrawer
          activeCategory={null}
          totalCount={24}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

    const body = document.querySelector('[data-slot="sheet-body"]');
    expect(body).not.toBeNull();
  });

  // The toolbar's 清除全部 clears search, category, sub and material and keeps
  // sort; the drawer's clear-all must clear exactly the same keys.
  it("drawer clear-all clears the same keys as the toolbar's clear-all", () => {
    searchParams.current = new URLSearchParams(
      "search=tea&category=home&sub=candles&material=wood&sort=newest",
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BrandFilterDrawer
          activeCategory="home"
          totalCount={24}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(replace).toHaveBeenCalledWith("/brands?sort=newest", {
      scroll: false,
    });
  });
});
