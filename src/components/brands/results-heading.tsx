import type { ReactNode } from "react";

/** The id the pager scrolls to and focuses after a page change (DS-01). */
export const RESULTS_HEADING_ID = "results-heading";

/**
 * The results region's own heading: screen-reader only, and the target the
 * pager moves focus to. `sr-only` is absolutely positioned with no offsets, so
 * it keeps its static flow position and `scrollIntoView` lands at the top of
 * the results; `scroll-mt` clears the sticky header.
 */
export function ResultsHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      id={RESULTS_HEADING_ID}
      tabIndex={-1}
      className="sr-only scroll-mt-(--nav-height) focus:outline-none"
    >
      {children}
    </h2>
  );
}
