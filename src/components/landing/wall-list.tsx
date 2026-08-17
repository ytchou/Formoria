"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The list element of the wall, plus the phone-only reveal control.
 *
 * A client island rather than a client wall: the tiles arrive as server-rendered
 * children and stay out of the client graph. Only the expanded flag lives here,
 * and it is published as a data attribute so the cap can be pure CSS — every
 * tile stays in the server HTML for crawlers and for the one-rationale-per-tile
 * contract, exactly as `masonry-grid.tsx` does with `visibleCount`.
 *
 * The control reveals in place. It becomes a link to the selection index once
 * DEV-1488 ships; until then a placeholder href would be a dead end.
 *
 * It is a disclosure, and carries the full disclosure semantics: `aria-expanded`
 * for the state and `aria-controls` for the list it reveals. It stays mounted
 * after activation — unmounting it dropped focus to `<body>`, which loses a
 * keyboard user's position and announces nothing at the moment twelve-plus
 * tiles appear. Staying mounted keeps focus on the control, so the state change
 * is announced where the user already is.
 */
export function WallList({
  ariaLabel,
  className,
  showMoreLabel,
  showLessLabel,
  showControl,
  children,
}: {
  ariaLabel: string;
  className?: string;
  showMoreLabel: string;
  showLessLabel: string;
  showControl: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  return (
    <>
      <ul
        id={listId}
        aria-label={ariaLabel}
        data-wall-expanded={expanded ? "true" : "false"}
        className={cn("group/wall list-none p-0", className)}
      >
        {children}
      </ul>

      {showControl ? (
        <div className="mt-6 sm:hidden">
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((current) => !current)}
            className="min-h-11 w-full justify-center"
          >
            {expanded ? showLessLabel : showMoreLabel}
          </Button>
        </div>
      ) : null}
    </>
  );
}
