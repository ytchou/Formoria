import type { ReactNode } from "react";

type FilterAsideProps = {
  children: ReactNode;
  "aria-label"?: string;
};

/**
 * The desktop filter column, shared by /discover and /brands.
 *
 * The aside keeps the flex row's default `align-self: stretch`, so it is as
 * tall as the results column — that height is the track the inner wrapper
 * sticks within. Making the aside `self-start` would shrink it to its content
 * and leave sticky nowhere to travel. The inner wrapper caps itself at the
 * viewport below the nav and scrolls, so a tall option list is never cut off.
 * `px-1` keeps the rows' focus ring inside the scroll box's clip.
 */
export function FilterAside({
  children,
  "aria-label": ariaLabel,
}: FilterAsideProps) {
  return (
    <aside aria-label={ariaLabel} className="hidden shrink-0 lg:block lg:w-56">
      <div className="sticky top-(--nav-height) max-h-[calc(100dvh-var(--nav-height))] overflow-y-auto px-1 py-4">
        {children}
      </div>
    </aside>
  );
}
