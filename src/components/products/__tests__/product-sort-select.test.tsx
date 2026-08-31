/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/discover",
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { ProductSortSelect } = await import("../product-sort-select");

describe("ProductSortSelect", () => {
  it("test_sort_select_renders_two_options", () => {
    render(<ProductSortSelect currentSort="newest" />);

    const select = screen.getByRole("combobox");
    const options = screen.getAllByRole("option");

    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("sortNewest");
    expect(options[1]).toHaveTextContent("sortAlphabetical");
    expect(select).toHaveValue("newest");
  });

  it("test_sort_select_updates_url", () => {
    mockReplace.mockClear();
    render(<ProductSortSelect currentSort="newest" />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "alphabetical" } });

    expect(mockReplace).toHaveBeenCalledWith(
      "/discover?sort=alphabetical",
      { scroll: false },
    );
  });
});
