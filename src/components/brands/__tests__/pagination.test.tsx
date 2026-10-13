/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

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

const { Pagination } = await import("../pagination");

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
