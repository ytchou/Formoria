import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

type DirectoryToolbarProps = {
  /** The mobile filter drawer trigger; hidden from `lg` up, where the sidebar shows. */
  filterTrigger?: ReactNode;
  /**
   * The result count. Rendered in the 黑體 label style; children may restyle
   * their own parts. Omit when the page states the count elsewhere.
   */
  count?: ReactNode;
  /** Applied-filter chips and their 清除全部. Omit when nothing is applied. */
  chips?: ReactNode;
  /** The sort control, pushed to the right edge. */
  sort?: ReactNode;
};

/**
 * The row at the top of a listing's results column, shared by /discover and
 * /brands: count · divider · applied chips · 清除全部 ………… sort.
 *
 * From `lg` up it is one line that wraps only if it must. Below `lg` the
 * filter trigger, count and sort share the first line and the chips drop to a
 * full-width line of their own (`order-last`), so nothing scrolls sideways.
 */
export function DirectoryToolbar({
  filterTrigger,
  count,
  chips,
  sort,
}: DirectoryToolbarProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      {filterTrigger ? <div className="lg:hidden">{filterTrigger}</div> : null}
      {count ? <div className="type-label tabular-nums">{count}</div> : null}
      {chips ? (
        <>
          {count ? (
            // 20px, centred: the primitive stretches a vertical rule by default.
            <Separator
              orientation="vertical"
              aria-hidden="true"
              className="hidden h-5 data-vertical:self-center lg:block"
            />
          ) : null}
          <div className="order-last w-full min-w-0 lg:order-none lg:w-auto">
            {chips}
          </div>
        </>
      ) : null}
      {sort ? <div className="ml-auto">{sort}</div> : null}
    </div>
  );
}
