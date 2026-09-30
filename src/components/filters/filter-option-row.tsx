import { cn } from "@/lib/utils";

/**
 * Shared row visuals for the filter sidebar: the 分類 radio links and the
 * 子分類/材質 checkbox labels use this one class string so the groups cannot
 * drift apart.
 *
 * 32px rows. Below the 44px touch minimum, but stacked with no overlap they
 * pass the spacing exception: 24px targets centred on adjacent 32px rows never
 * intersect. Ceiling: rows must stay flush — adding gaps is fine, overlapping
 * or shrinking below 32px is not. Upgrade path if touch misses show up in the
 * drawer: `min-h-11` rows inside the drawer only.
 *
 * `grid` (not flex) keeps the category links out of the button-geometry gate:
 * these are list rows, not buttons. Columns: indicator, label, count.
 *
 * Text styling lives on {@link FilterOptionLabel}, not here: `<Label>` injects
 * `type-body-sm`, and `cn` cannot dedupe the custom type-* utilities, so on
 * the row itself whichever Tailwind emits last wins (type-body-sm, 明體 15px).
 */
export const filterOptionRowClassName =
  "group grid min-h-8 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-control px-2 hover:bg-surface";

/**
 * The row's label. State goes on this span, beside `type-nav`: `type-nav`
 * sets its own weight and colour, so a weight or colour on the row would be
 * overridden here. The compiled CSS emits `font-semibold` and `text-ink-soft`
 * after `type-nav`, so they win on the same element.
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

/**
 * Decorative radio circle for the single-select category links. Same 16px box
 * as the Checkbox; the link itself carries the state via `aria-current`.
 */
export function FilterRadioIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-4 place-items-center rounded-full border",
        selected ? "border-accent" : "border-rule",
      )}
    >
      {selected && <span className="size-2 rounded-full bg-accent" />}
    </span>
  );
}
