import { ChipRow, taxonomyLinkClasses } from "@/components/ui/toggle-chip";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";

export type HubTagChip = { slug: string; label: string };

/**
 * The /style hub's tag filter. The filter lives in the query string, so the
 * chips are links and work with JS off. A tag with no chip is one the filter
 * ignores (unknown), so it leaves 全部 current.
 */
export function HubTagChipRow({
  chips,
  activeTag,
  allLabel,
}: {
  chips: HubTagChip[];
  activeTag: string | null;
  allLabel: string;
}) {
  const current = chips.some((chip) => chip.slug === activeTag)
    ? activeTag
    : null;
  const items = [{ slug: null, label: allLabel }, ...chips];

  return (
    <ChipRow as="ul">
      {items.map((chip) => {
        const active = chip.slug === current;
        return (
          <li key={chip.slug ?? "all"}>
            <Link
              href={
                chip.slug
                  ? `${routes.style()}?tag=${encodeURIComponent(chip.slug)}`
                  : routes.style()
              }
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={taxonomyLinkClasses({ active })}
            >
              {chip.label}
            </Link>
          </li>
        );
      })}
    </ChipRow>
  );
}
