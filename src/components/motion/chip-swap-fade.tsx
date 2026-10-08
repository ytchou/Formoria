"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { fadeInSwappedItems } from "@/lib/motion/chip-swap";

/**
 * Fades a chip-filtered list's incoming items in when `swapKey` changes
 * (DESIGN.md §7b). The first render — page load and hydration — is never
 * animated; page entrance motion is reserved for the hero.
 */
export function ChipSwapFade({
  swapKey,
  itemSelector = ":scope > ul > li",
  children,
}: {
  /** Identifies the current filter; a change is a swap. */
  swapKey: string;
  /** The incoming items, relative to the wrapper. */
  itemSelector?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousKey = useRef(swapKey);

  useLayoutEffect(() => {
    if (previousKey.current === swapKey) return;
    previousKey.current = swapKey;
    const container = ref.current;
    if (container) fadeInSwappedItems(container.querySelectorAll(itemSelector));
  }, [swapKey, itemSelector]);

  return <div ref={ref}>{children}</div>;
}
