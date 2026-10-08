// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FaqBlock } from "../faq-block";

const questions = [
  { q: "When is the expo?", a: "It runs for five days in August." },
  { q: "Is entry free?", a: "Yes, with registration." },
];

describe("FaqBlock", () => {
  // DESIGN.md §7: an answer to a question ships visible in the server HTML,
  // never behind a collapsed panel.
  it("renders every answer visibly without interaction", () => {
    const { container } = render(<FaqBlock questions={questions} />);

    for (const { q, a } of questions) {
      expect(screen.getByText(q).tagName).toBe("DT");
      const answer = screen.getByText(a);
      expect(answer.tagName).toBe("DD");
      expect(answer).toBeVisible();
    }
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks the content language when it differs from the page", () => {
    const { container } = render(
      <FaqBlock questions={questions} lang="zh-Hant-TW" />,
    );

    expect(container.querySelector("section")).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
  });

  it("renders nothing without questions", () => {
    const { container } = render(<FaqBlock questions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
