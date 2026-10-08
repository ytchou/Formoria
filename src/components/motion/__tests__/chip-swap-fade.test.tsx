// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChipSwapFade } from "../chip-swap-fade";

const animate = vi.fn();
const originalAnimate = Element.prototype.animate;
const originalMatchMedia = window.matchMedia;

function grid(items: string[]) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  animate.mockReset();
  Element.prototype.animate = animate as unknown as Element["animate"];
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
  window.matchMedia = originalMatchMedia;
});

describe("ChipSwapFade", () => {
  it("does not animate the initial render", () => {
    render(<ChipSwapFade swapKey="all">{grid(["a", "b"])}</ChipSwapFade>);

    expect(animate).not.toHaveBeenCalled();
  });

  it("fades the incoming items in after the swap key changes", () => {
    const { rerender } = render(
      <ChipSwapFade swapKey="all">{grid(["a", "b"])}</ChipSwapFade>,
    );

    rerender(<ChipSwapFade swapKey="home">{grid(["c", "d", "e"])}</ChipSwapFade>);

    expect(animate).toHaveBeenCalledTimes(3);
  });

  it("does not animate a re-render with the same swap key", () => {
    const { rerender } = render(
      <ChipSwapFade swapKey="all">{grid(["a"])}</ChipSwapFade>,
    );

    rerender(<ChipSwapFade swapKey="all">{grid(["a"])}</ChipSwapFade>);

    expect(animate).not.toHaveBeenCalled();
  });
});
