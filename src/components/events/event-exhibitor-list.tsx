"use client";

import type { RefObject } from "react";
import type { CreativeExpoEntry } from "@/lib/services/events";
import { EventExhibitorRow } from "./event-exhibitor-row";

type EventExhibitorListProps = {
  entries: readonly CreativeExpoEntry[];
  eventSlug: string;
  /** Inclusive start of the visible page window. */
  startIndex: number;
  /** Exclusive end of the visible page window. */
  endIndex: number;
  listRef?: RefObject<HTMLUListElement | null>;
};

/**
 * Renders every exhibitor and hides the rows outside the current page with CSS.
 *
 * The window is never sliced: the whole hall stays in the server HTML, so a
 * crawler still sees every `/brands/...` link no matter which page a visitor
 * happens to be on. Same mechanic as `MasonryGrid`'s `visibleCount`.
 *
 * `tabIndex={-1}` exists so a page change can move focus here — see the focus
 * handling in `TaiwanCreativeExpoExplorer`.
 */
export function EventExhibitorList({
  entries,
  eventSlug,
  startIndex,
  endIndex,
  listRef,
}: EventExhibitorListProps) {
  return (
    <ul
      ref={listRef}
      tabIndex={-1}
      className="divide-y divide-rule border-y border-rule focus:outline-none"
    >
      {entries.map((entry, index) => (
        <EventExhibitorRow
          key={entry.id}
          entry={entry}
          eventSlug={eventSlug}
          // Absolute index in the filtered list: this map covers every row, not
          // just the visible window, so it is already page-independent.
          position={index}
          hidden={index < startIndex || index >= endIndex}
        />
      ))}
    </ul>
  );
}
