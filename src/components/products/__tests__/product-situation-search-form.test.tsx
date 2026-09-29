/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductSituationSearchForm } from "../product-situation-search-form";

describe("ProductSituationSearchForm", () => {
  it("renders hidden infer=1 and no category/sub/material hidden inputs", () => {
    const { container } = render(
      <ProductSituationSearchForm
        locale="zh-TW"
        query="送給剛搬家的朋友"
        labels={{ label: "搜尋情境", placeholder: "例", submit: "搜尋" }}
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
});
