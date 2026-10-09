import type { ReactNode } from "react";

type DirectoryToolbarProps = {
  /** The mobile filter drawer trigger; hidden from `lg` up, where the sidebar shows. */
  filterTrigger?: ReactNode;
  /** Applied-filter chips and their 清除全部. Omit when nothing is applied. */
  chips?: ReactNode;
  /** The sort control, pushed to the right edge. */
  sort?: ReactNode;
};

/**
 * The row at the top of a listing's results column, shared by /discover and
 * /brands: applied chips · 清除全部 ………… sort.
 *
 * The result count is not here — it sits in the header's intro line
 * (`DirectoryHeader` `meta`). Below `lg` the filter trigger and the sort
 * share one row and the chips drop to a full-width line of their own
 * (`order-last`), so the first result is never three toolbar rows down.
 */
export function DirectoryToolbar({
  filterTrigger,
  chips,
  sort,
}: DirectoryToolbarProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      {filterTrigger ? <div className="lg:hidden">{filterTrigger}</div> : null}
      {chips ? (
        <div className="order-last w-full min-w-0 lg:order-none lg:w-auto">
          {chips}
        </div>
      ) : null}
      {sort ? <div className="ml-auto">{sort}</div> : null}
    </div>
  );
}
