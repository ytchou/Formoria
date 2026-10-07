// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrailSnapRow } from "../trail-snap-row";

/**
 * jsdom has no layout, so every `offsetLeft` is 0 and `scrollLeft` never
 * moves. Both are pinned with `defineProperty` to the geometry of a 390px row:
 * cards 300px wide with a 24px gap, starting 6px in (the row's padding). The
 * 6px origin is deliberate — the component must measure from the first card,
 * not from the raw offset.
 */
const CARD_PITCH = 324;
const ORIGIN = 6;

function renderRow(count: number) {
  const result = render(
    <TrailSnapRow count={count} className="flex">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>Trail {index + 1}</li>
      ))}
    </TrailSnapRow>,
  );
  const list = screen.getByRole("list");
  for (const [index, item] of Array.from(list.children).entries()) {
    Object.defineProperty(item, "offsetLeft", {
      configurable: true,
      value: ORIGIN + index * CARD_PITCH,
    });
  }
  return { ...result, list };
}

function scrollTo(list: HTMLElement, left: number) {
  Object.defineProperty(list, "scrollLeft", { configurable: true, value: left });
  fireEvent.scroll(list);
}

describe("TrailSnapRow", () => {
  it("starts at the first card", () => {
    const { container } = renderRow(5);

    expect(container.querySelector("[data-trail-counter]")).toHaveTextContent(
      "1 / 5",
    );
  });

  it("follows the card nearest the scroll position", () => {
    const { container, list } = renderRow(5);
    const counter = container.querySelector("[data-trail-counter]");

    scrollTo(list, CARD_PITCH);
    expect(counter).toHaveTextContent("2 / 5");

    // Mid-swipe, past the halfway point toward card 4.
    scrollTo(list, CARD_PITCH * 2 + CARD_PITCH * 0.6);
    expect(counter).toHaveTextContent("4 / 5");

    // The last card cannot reach the start edge; max scroll still reads 5.
    scrollTo(list, CARD_PITCH * 4 - 68);
    expect(counter).toHaveTextContent("5 / 5");

    scrollTo(list, 0);
    expect(counter).toHaveTextContent("1 / 5");
  });

  it("keeps the counter out of the accessibility tree and the list", () => {
    const { container, list } = renderRow(3);
    const counter = container.querySelector("[data-trail-counter]");

    expect(counter).toHaveAttribute("aria-hidden", "true");
    expect(list.contains(counter)).toBe(false);
    expect(list.children).toHaveLength(3);
  });

  it("renders no counter for a single card", () => {
    const { container } = renderRow(1);

    expect(container.querySelector("[data-trail-counter]")).toBeNull();
  });
});
