// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchFieldShell } from "../search-field-shell";

function renderShell(value: string, onClear = vi.fn()) {
  const utils = render(
    <SearchFieldShell
      value={value}
      onChange={() => {}}
      onClear={onClear}
      clearLabel="清除搜尋"
      inputProps={{ type: "search", "aria-label": "搜尋" }}
    />,
  );
  return { ...utils, onClear };
}

describe("SearchFieldShell", () => {
  it("reserves the full 44px clear-button width on the right", () => {
    renderShell("a long query");
    expect(screen.getByRole("searchbox")).toHaveClass("pr-11");
    expect(screen.getByRole("searchbox")).not.toHaveClass("pr-8");
  });

  it("renders the lucide search and clear icons, hidden from assistive tech", () => {
    const { container, onClear } = renderShell("query");
    expect(container.querySelector("svg.lucide-search")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const clear = screen.getByRole("button", { name: "清除搜尋" });
    expect(clear.querySelector("svg.lucide-x")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("shows no clear button for an empty field", () => {
    renderShell("");
    expect(screen.queryByRole("button", { name: "清除搜尋" })).toBeNull();
  });
});
