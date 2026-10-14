// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RESULTS_HEADING_ID, ResultsHeading } from "../results-heading";

// The pager focuses this element after a page change, so it must be a
// programmatically focusable h2 under the page h1, not a visible-only label.
describe("ResultsHeading", () => {
  it("renders a focusable level-2 heading with the shared id", () => {
    render(<ResultsHeading>品牌列表（共 3 個）</ResultsHeading>);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("id", RESULTS_HEADING_ID);
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveClass("sr-only");
    expect(heading).toHaveTextContent("品牌列表（共 3 個）");
  });
});
