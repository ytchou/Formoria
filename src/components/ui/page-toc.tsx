import { cn } from "@/lib/utils";

/**
 * The on-page table of contents, written once (DS-11).
 *
 * FAQ, privacy and terms each hand-rolled one. Navigation is 黑體 (DESIGN.md
 * §1: 明體 is what you read, 黑體 is what you operate), so both variants set
 * their links in `type-nav` with a 44px target.
 *
 * - `rail`: the sticky side column (FAQ) — a ruled left edge, 48px rows.
 * - `inline`: a stacked accent list inside a document header (legal pages).
 *
 * The accessible name is always `aria-label={label}`. A visible label, when
 * shown, is hidden from assistive tech so the name is not announced twice;
 * e2e queries the nav by this exact name.
 */
export type PageTocItem = { id: string; label: string };

export type PageTocProps = {
  items: ReadonlyArray<PageTocItem>;
  label: string;
  variant: "rail" | "inline";
  labelVisible?: boolean;
  className?: string;
};

const LINK_BASE =
  "type-nav hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const VARIANTS = {
  rail: {
    list: "space-y-1 border-l border-rule pl-3",
    link: "flex min-h-12 items-center px-3",
  },
  inline: {
    list: "",
    link: "inline-flex min-h-11 items-center rounded-control text-accent underline-offset-4 hover:underline",
  },
} as const;

export function PageToc({
  items,
  label,
  variant,
  labelVisible = false,
  className,
}: PageTocProps) {
  const styles = VARIANTS[variant];

  return (
    <nav aria-label={label} className={className}>
      {labelVisible && (
        <p aria-hidden="true" className="type-body-sm font-semibold text-ink">
          {label}
        </p>
      )}
      <ol className={cn(styles.list, labelVisible && "mt-1")}>
        {items.map(({ id, label: itemLabel }) => (
          <li key={id}>
            <a href={`#${id}`} className={cn(LINK_BASE, styles.link)}>
              {itemLabel}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
