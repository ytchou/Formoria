import { cn } from "@/lib/utils";

/**
 * Shared row visuals for the filter sidebar: the 分類 radio links and the
 * 子分類/材質 checkbox labels use this one class string so the groups cannot
 * drift apart.
 *
 * 44px rows: the DESIGN.md §7 touch minimum, with no exception (only chips
 * get the 36px one). The row element itself is the hit area — the checkbox
 * rows' `<Label>` and the category rows' `<a>` carry this class, so the
 * indicator, label and count are all one full-width target. Never shrink below
 * `min-h-11` and never move the class onto an inner element.
 *
 * `grid` (not flex) keeps the category links out of the button-geometry gate:
 * these are list rows, not buttons. Columns: indicator, label, count.
 *
 * Text styling lives on {@link FilterOptionLabel}, not here: the row also holds
 * the indicator and the count, and the count keeps its own `type-metadata`.
 * The same label span serves the checkbox rows (a `<Label>`) and the category
 * links (an `<a>`), so the selected state is styled in one place.
 */
export const filterOptionRowClassName =
  "group grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-control px-2 hover:bg-surface";

/**
 * The row's label. State goes on this span, beside `type-nav`: `type-nav`
 * sets its own weight and colour, so a weight or colour on the row would be
 * overridden here. `cn` keeps weight and colour classes placed after a type
 * role, and the compiled CSS emits `font-semibold` and `text-ink-soft` after
 * `type-nav`, so they win on the same element.
 */
export function FilterOptionLabel({
  selected,
  children,
}: {
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "type-nav",
        selected ? "font-semibold" : "text-ink-soft group-hover:text-ink",
      )}
    >
      {children}
    </span>
  );
}

export function FilterOptionCount({
  count,
  "aria-hidden": ariaHidden,
}: {
  count: number;
  "aria-hidden"?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className="type-metadata text-ink-muted tabular-nums"
    >
      {count}
    </span>
  );
}
