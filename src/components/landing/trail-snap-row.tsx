"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The homepage trail list plus its below-`md` position counter (「1 / 5」).
 *
 * The cards arrive as server-rendered `children`; this component owns only the
 * `<ul>` element (its classes come from the caller, which documents them) and
 * the counter under it. The counter is the row's only client state.
 *
 * The current card is the child whose left edge sits closest to the row's
 * scroll position. Offsets are measured from the FIRST child rather than read
 * raw, so the row's padding and whichever ancestor is the `offsetParent`
 * cancel out: at rest on card i, `scrollLeft` equals card i's offset from card
 * 0 because every card snaps to its start with the same scroll margin. The
 * last card cannot reach the start edge, but at maximum scroll it is still the
 * nearest one.
 *
 * The counter is `aria-hidden`: the list already announces its item count, and
 * a live region would speak on every snap. It is not rendered for one card.
 */
export function TrailSnapRow({
  count,
  className,
  children,
}: {
  /** The number of cards in the row — the counter's denominator. */
  count: number;
  className?: string;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  // `1` on the server and on first paint: the row always loads at its start.
  const [current, setCurrent] = useState(1);

  useEffect(() => {
    const list = listRef.current;
    if (!list || count < 2) return;

    function update() {
      if (!list) return;
      const items = Array.from(list.children) as HTMLElement[];
      const origin = items[0]?.offsetLeft ?? 0;
      let closest = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const [index, item] of items.entries()) {
        const distance = Math.abs(item.offsetLeft - origin - list.scrollLeft);
        if (distance < closestDistance) {
          closest = index;
          closestDistance = distance;
        }
      }
      // React bails out when the value is unchanged, so a scroll that stays
      // on one card does not re-render.
      setCurrent(closest + 1);
    }

    list.addEventListener("scroll", update, { passive: true });
    return () => list.removeEventListener("scroll", update);
  }, [count]);

  return (
    <>
      <ul ref={listRef} className={className}>
        {children}
      </ul>
      {count > 1 ? (
        <p
          aria-hidden="true"
          data-trail-counter
          className="mt-2 type-metadata text-ink-muted md:hidden"
        >
          {`${current} / ${count}`}
        </p>
      ) : null}
    </>
  );
}
