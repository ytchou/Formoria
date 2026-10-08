// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHIP_SWAP_FADE,
  chipSwapDelayMs,
  fadeInSwappedItems,
} from "../chip-swap";

function stubReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function animatedItems(count: number) {
  return Array.from({ length: count }, () => {
    const el = document.createElement("li");
    el.animate = vi.fn() as unknown as Element["animate"];
    return el;
  });
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("chipSwapDelayMs", () => {
  it("staggers by 20ms and caps at the 8th item", () => {
    expect(chipSwapDelayMs(0)).toBe(0);
    expect(chipSwapDelayMs(1)).toBe(20);
    expect(chipSwapDelayMs(7)).toBe(140);
    expect(chipSwapDelayMs(8)).toBe(140);
    expect(chipSwapDelayMs(30)).toBe(140);
  });

  it("treats a negative index as the first item", () => {
    expect(chipSwapDelayMs(-3)).toBe(0);
  });
});

describe("fadeInSwappedItems", () => {
  it("fades each item's opacity in over 160ms with the capped stagger", () => {
    stubReducedMotion(false);
    const items = animatedItems(10);

    fadeInSwappedItems(items);

    const delays = items.map((el) => {
      const animate = el.animate as unknown as ReturnType<typeof vi.fn>;
      expect(animate).toHaveBeenCalledTimes(1);
      const [keyframes, options] = animate.mock.calls[0];
      expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(options).toMatchObject({
        duration: CHIP_SWAP_FADE.durationMs,
        fill: "backwards",
      });
      expect(typeof options.easing).toBe("string");
      expect(options.easing).not.toBe("");
      return options.delay;
    });
    expect(delays).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 140, 140]);
  });

  it("does nothing under prefers-reduced-motion", () => {
    stubReducedMotion(true);
    const items = animatedItems(3);

    fadeInSwappedItems(items);

    for (const el of items) expect(el.animate).not.toHaveBeenCalled();
  });

  it("tolerates elements without the Web Animations API", () => {
    stubReducedMotion(false);
    const bare = { animate: undefined } as unknown as Element;

    expect(() => fadeInSwappedItems([bare])).not.toThrow();
  });
});
