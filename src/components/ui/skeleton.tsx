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
 * No local `motion-reduce:` branch, deliberately. `globals.css` already caps
 * every animation at 0.01ms with `animation-iteration-count: 1` under
 * `prefers-reduced-motion: reduce`, which is the house rule (0.01ms, never
 * `none`, so anything listening for `animationend` still hears it). A second
 * branch here would be a private copy of a global decision.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[3px] bg-surface-deep", className)}
      {...props}
    />
  );
}

export { Skeleton };
