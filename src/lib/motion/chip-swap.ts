/**
 * DESIGN.md §7b: content swapped in place by a chip filter. Outgoing items are
 * not animated; incoming items fade opacity 0→1 over 160ms with a 20ms
 * stagger, capped at the first 8 items (later items arrive with the 8th).
 */
export const CHIP_SWAP_FADE = {
  durationMs: 160,
  staggerMs: 20,
  staggerCap: 8,
} as const;

/** `--ease-settle` in globals.css, for a document that lacks the token. */
const EASE_SETTLE_FALLBACK = "cubic-bezier(0.33, 1, 0.68, 1)";

/** Item 0 starts at once; item 7 and every later item start at 140ms. */
export function chipSwapDelayMs(index: number): number {
  const capped = Math.min(Math.max(index, 0), CHIP_SWAP_FADE.staggerCap - 1);
  return capped * CHIP_SWAP_FADE.staggerMs;
}

function easeSettle(): string {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--ease-settle")
    .trim();
  return token || EASE_SETTLE_FALLBACK;
}

/**
 * Fades the incoming items of a chip swap in. Opacity only — never transform
 * or layout. The JS counterpart of `motion-safe:`: the global reduced-motion
 * block in globals.css does not reach Web Animations, so the preference is
 * checked here and a reduced-motion swap is instant.
 */
export function fadeInSwappedItems(items: Iterable<Element>): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  let easing: string | undefined;
  let index = 0;
  for (const el of items) {
    if (typeof el.animate !== "function") return;
    easing ??= easeSettle();
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: CHIP_SWAP_FADE.durationMs,
      delay: chipSwapDelayMs(index),
      easing,
      // Hold opacity 0 through each item's stagger delay.
      fill: "backwards",
    });
    index += 1;
  }
}
