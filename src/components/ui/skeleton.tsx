import { cn } from "@/lib/utils";

/**
 * A placeholder block: the shape of content that has not arrived.
 *
 * `surface-deep` rather than `surface`, because a skeleton has to read as
 * ABSENT against the card it sits inside — on the second material it goes
 * invisible the moment it lands on a `SurfaceCard`, which is where most of
 * these live. The 3px radius is the surface radius, not the control one: this
 * stands in for a block of text, never for a button.
 *
 * Static, never pulsing (EL-13): a pulse is motion decorating a state that is
 * not changing (DESIGN.md §7b). `animate-skeleton-in` holds the plate at
 * opacity 0 for 300ms and then fades it in over 160ms, so a load that finishes
 * fast never flashes a placeholder at all.
 *
 * No local `motion-reduce:` branch, deliberately. `globals.css` already caps
 * every animation at 0.01ms under `prefers-reduced-motion: reduce`, which is
 * the house rule; the 300ms delay survives it, and that is intended — waiting
 * is not motion. A second branch here would be a private copy of a global
 * decision.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-skeleton-in rounded-surface bg-surface-deep", className)}
      {...props}
    />
  );
}

export { Skeleton };
