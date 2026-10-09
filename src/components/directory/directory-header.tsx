import type { ReactNode } from "react";

type DirectoryHeaderProps = {
  /** The page's h1 text. */
  title: ReactNode;
  /** The one lede under the h1 (DESIGN.md §1 `type-lede`). Omit in search mode. */
  lede?: ReactNode;
  /**
   * The intro line in 黑體: the result count, and in search mode the query
   * echo before it. Interface text, so it never takes the lede's 明體.
   */
  meta?: ReactNode;
  /** The labelled search form, placed right of the title from `lg` up. */
  search?: ReactNode;
};

/**
 * The top of a listing page, shared by /discover and /brands: an editorial
 * head — 明體 title, lede, then the count line — with the page's own search on
 * the right, bottom-aligned with the text. Below `lg` the two stack and the
 * search goes full width.
 *
 * A hairline `rule` closes the header instead of boxed chrome (DESIGN.md §8:
 * elevation is borders, not shadows). The count lives here, not in the
 * results toolbar, so the toolbar below `lg` is one row of 篩選 and sort.
 */
export function DirectoryHeader({
  title,
  lede,
  meta,
  search,
}: DirectoryHeaderProps) {
  return (
    <header className="flex flex-col gap-6 border-b border-rule pb-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
      <div className="min-w-0 space-y-3">
        <h1 className="type-page-title">{title}</h1>
        {lede ? <p className="type-lede">{lede}</p> : null}
        {meta ? (
          <div className="type-label min-w-0 tabular-nums text-ink-soft">
            {meta}
          </div>
        ) : null}
      </div>
      {search ? <div className="w-full lg:w-xl lg:shrink-0">{search}</div> : null}
    </header>
  );
}
