// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PullQuote } from "../pull-quote";
import { StoryFigure } from "../story-figure";

/**
 * EL-11: the pull quote is an editorial moment set in type, not a 藍染 bar.
 * The accent is interaction only (DESIGN §2), and a quote is not interactive.
 */
describe("PullQuote", () => {
  it("sets an unattributed line in the page-title step with no accent", () => {
    const { container } = render(<PullQuote>不經手買賣。</PullQuote>);

    const quote = container.querySelector("p");
    expect(quote?.className).toContain("type-page-title");
    expect(quote?.className).toContain("my-section");
    expect(container.innerHTML).not.toContain("accent");
    expect(container.querySelector("blockquote")).toBeNull();
  });

  it("hangs decorative corner brackets that stay out of the text", () => {
    const { container } = render(<PullQuote>不經手買賣。</PullQuote>);

    const brackets = [
      ...container.querySelectorAll('[aria-hidden="true"]'),
    ].map((node) => node.textContent);
    expect(brackets).toEqual(["「", "」"]);
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain(
      "md:-ml-[1em]",
    );
    expect(screen.getByText("不經手買賣。")).toBeInTheDocument();
  });

  it("keeps an attributed quote a blockquote with its citation", () => {
    const { container } = render(
      <PullQuote attribution="Ziliaoshi, founder">The line.</PullQuote>,
    );

    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(screen.getByText("Ziliaoshi, founder").tagName).toBe("CITE");
    expect(container.innerHTML).not.toContain("accent");
  });
});

/** EL-10: at `xl` the credit moves into the right margin, magazine-style. */
describe("StoryFigure", () => {
  it("anchors the caption to the figure for the margin placement", () => {
    const { container } = render(
      <StoryFigure src="/x.webp" alt="窯" caption="攝影：這一窯" />,
    );

    expect(container.querySelector("figure")?.className).toContain("relative");
    const caption = container.querySelector("figcaption");
    expect(caption?.className).toContain("xl:absolute");
    expect(caption?.className).toContain("xl:left-[calc(100%+1.5rem)]");
  });
});
