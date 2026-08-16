"use client";

import { useState, type ReactNode } from "react";

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
 * The control reveals in place. It becomes a link to the 選物 index once
 * DEV-1488 ships; until then a placeholder href would be a dead end.
 */
export function WallList({
  ariaLabel,
  className,
  showMoreLabel,
  showControl,
  children,
}: {
  ariaLabel: string;
  className?: string;
  showMoreLabel: string;
  showControl: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <ul
        aria-label={ariaLabel}
        data-wall-expanded={expanded ? "true" : "false"}
        className={cn("group/wall list-none p-0", className)}
      >
        {children}
      </ul>

      {showControl && !expanded ? (
        <div className="mt-6 sm:hidden">
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            onClick={() => setExpanded(true)}
            className="min-h-11 w-full justify-center"
          >
            {showMoreLabel}
          </Button>
        </div>
      ) : null}
    </>
  );
}
