/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import zhMessages from "../../../../messages/zh-TW.json";

const { searchParams } = vi.hoisted(() => ({
  searchParams: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  usePathname: () => "/brands",
}));

vi.mock("@/lib/analytics", () => ({
  trackDirectoryPageNavigated: vi.fn(),
}));

// A plain anchor: the real Link dispatches into the app router, which does not
// exist in jsdom. `rel` and `onClick` pass through, which is all these specs
// read; `scroll`/`prefetch` are router options with no DOM meaning.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    prefetch: _prefetch,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    prefetch?: boolean;
    scroll?: boolean;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

const { Pagination } = await import("../pagination");
const { ResultsHeading, RESULTS_HEADING_ID } = await import(
  "../results-heading"
);

function renderPagination(query: string) {
  searchParams.current = new URLSearchParams(query);
  render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <Pagination totalCount={100} currentPage={2} pageSize={10} />
    </NextIntlClientProvider>,
  );
  return screen.getAllByRole("link");
}

// DEV-2018: page links on a multi-value `sub=` facet were the internal links
// that kept Google discovering new filter combinations.
describe("Pagination rel", () => {
  it.each([
    "category=home&sub=lighting,plants",
    "category=home&sub=lighting&sub=plants",
  ])(
    "marks every page link nofollow on a multi-value sub page (%s)",
    (query) => {
      const links = renderPagination(query);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("rel", "nofollow");
    },
  );

  it.each(["", "category=home", "category=home&sub=lighting"])(
    "leaves page links followable without a multi-value sub (%s)",
    (query) => {
      for (const link of renderPagination(query))
        expect(link).not.toHaveAttribute("rel");
    },
  );
});

// DS-01: the pager links keep `scroll={false}`, so without this the reader is
// left by the footer with focus on 「下一頁」 and nothing announced.
describe("Pagination focus", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    searchParams.current = new URLSearchParams();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    // jsdom has no scrollIntoView; leave the prototype as we found it.
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  function page(currentPage: number) {
    return (
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <ResultsHeading>results</ResultsHeading>
        <Pagination totalCount={100} currentPage={currentPage} pageSize={10} />
      </NextIntlClientProvider>
    );
  }

  it("moves focus to the results heading after a pager click renders the new page", () => {
    const { rerender } = render(page(2));

    fireEvent.click(
      screen.getByRole("link", { name: zhMessages.brands.pagination.nextAria }),
    );
    rerender(page(3));

    const heading = document.getElementById(RESULTS_HEADING_ID);
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("leaves focus alone when the page changes without a pager click", () => {
    // A filter or sort change resets the page; DESIGN §7b keeps results in place.
    const { rerender } = render(page(2));

    rerender(page(1));

    expect(document.activeElement).not.toBe(
      document.getElementById(RESULTS_HEADING_ID),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("announces the page position politely", () => {
    render(page(2));

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
