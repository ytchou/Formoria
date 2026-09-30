/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductSituationSearchForm } from "../product-situation-search-form";

describe("ProductSituationSearchForm", () => {
  it("renders hidden infer=1 and no category/sub/material hidden inputs", () => {
    const { container } = render(
      <ProductSituationSearchForm
        locale="zh-TW"
        query="送給剛搬家的朋友"
        labels={{
          label: "搜尋情境",
          placeholder: "例",
          submit: "搜尋",
          clear: "清除搜尋",
        }}
      />,
    );

    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    );
    expect(hidden.map((input) => [input.name, input.value])).toEqual([
      ["infer", "1"],
    ]);
    expect(container.querySelector('input[name="category"]')).toBeNull();
    expect(container.querySelector('input[name="sub"]')).toBeNull();
    expect(container.querySelector('input[name="material"]')).toBeNull();
  });

  it("labels the searchbox visibly and submits with a 搜尋 button", () => {
    render(
      <ProductSituationSearchForm
        locale="zh-TW"
        query={null}
        labels={{
          label: "搜尋商品",
          placeholder: "例",
          submit: "搜尋",
          clear: "清除搜尋",
        }}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "搜尋商品" });
    expect(input).toHaveAttribute("name", "q");
    expect(screen.getByRole("button", { name: "搜尋" })).toHaveAttribute(
      "type",
      "submit",
    );

    fireEvent.change(input, { target: { value: "送禮" } });
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋" }));
    expect(input).toHaveValue("");
  });
});
