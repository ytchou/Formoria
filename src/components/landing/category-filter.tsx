"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";

import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import { Button } from "@/components/ui/button";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import type { AppLocale } from "@/i18n/locale-preference";
import type { WallTileSlot } from "@/lib/curated-products/wall-tile";
import { fadeInSwappedItems } from "@/lib/motion/chip-swap";
import { cn } from "@/lib/utils";
import { WallGroupPlaceholder } from "./wall-group";

/**
 * Click-gated (DEV-1972): the tile and everything it imports (the taxonomy
 * ontology among them) reach the browser on the first category chip, never in
 * the homepage's initial bundle. The server renders the "all" group through
 * the same component, so a fetched group is markup-identical to it.
 */
const loadWallGroupGrid = () =>
  import("./wall-group-grid").then((m) => m.WallGroupGrid);

/**
 * DESIGN.md §7b chip swap for a fetched or cached group: its tiles fade in
 * when the real grid mounts. The fade lives inside the lazy chunk because the
 * chunk can land after the group's data — an effect in the filter would then
 * find only the loading fallback and the swap would lose its fade.
 */
const loadFadingWallGroupGrid = () =>
  loadWallGroupGrid().then((Grid) => {
    function FadingWallGroupGrid(props: ComponentProps<typeof Grid>) {
      const ref = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => {
        if (ref.current) {
          fadeInSwappedItems(
            ref.current.querySelectorAll(":scope > div > ul > li"),
          );
        }
      }, []);
      return (
        <div ref={ref} className="contents">
          <Grid {...props} />
        </div>
      );
    }
    return FadingWallGroupGrid;
  });

const WallGroupGrid = dynamic(loadFadingWallGroupGrid, {
  ssr: false,
  loading: () => <WallGroupPlaceholder />,
});

type CategoryOption = {
  slug: string;
  label: string;
};

type CategoryFilterLabels = {
  tile: SelectedProductTileLabels;
  loading: string;
  loadFailed: string;
  retry: string;
};

type GroupState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; slots: WallTileSlot[] };

type InflightRequest = { slug: string; controller: AbortController };

type CategoryFilterProps = {
  categories: CategoryOption[];
  locale: AppLocale;
  labels: CategoryFilterLabels;
  /** The server-rendered "all" group. */
  children: ReactNode;
};

async function fetchWallGroup(
  slug: string,
  signal: AbortSignal,
): Promise<WallTileSlot[]> {
  const url = `/api/home-wall?category=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`home-wall ${res.status}`);
  const data = (await res.json()) as { slots?: unknown };
  if (!Array.isArray(data.slots)) throw new Error("home-wall: no slots");
  return data.slots as WallTileSlot[];
}

export function CategoryFilter({
  categories,
  locale,
  labels,
  children,
}: CategoryFilterProps) {
  const [active, setActive] = useState("all");
  // Per-slug results, so re-selecting a loaded category is instant.
  const [groups, setGroups] = useState<Record<string, GroupState>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inflightRef = useRef<InflightRequest | null>(null);
  // The group shown before this render, so only a swap back to the
  // server-rendered "all" group fades — never the page load (DESIGN.md §7b
  // reserves entrance motion for the hero).
  const previousActiveRef = useRef(active);

  function load(slug: string) {
    inflightRef.current?.controller.abort();
    const controller = new AbortController();
    inflightRef.current = { slug, controller };
    setGroups((prev) => ({ ...prev, [slug]: { status: "loading" } }));
    // Warm the tile chunk beside the request instead of after it. A failed
    // chunk load surfaces when the group renders; this warm-up stays silent.
    loadWallGroupGrid().catch(() => undefined);

    fetchWallGroup(slug, controller.signal).then(
      (slots) => {
        if (inflightRef.current?.controller !== controller) return;
        inflightRef.current = null;
        setGroups((prev) => ({ ...prev, [slug]: { status: "ready", slots } }));
      },
      () => {
        // An aborted or superseded request is not this group's failure.
        if (inflightRef.current?.controller !== controller) return;
        inflightRef.current = null;
        setGroups((prev) => ({ ...prev, [slug]: { status: "error" } }));
      },
    );
  }

  function handleSelect(slug: string) {
    if (slug === active) return;

    // Only the active category is ever in flight, so a new selection always
    // supersedes it. Its entry is dropped so returning to it fetches again.
    const inflight = inflightRef.current;
    if (inflight) {
      inflight.controller.abort();
      inflightRef.current = null;
      setGroups((prev) => {
        const next = { ...prev };
        delete next[inflight.slug];
        return next;
      });
    }

    setActive(slug);

    // The "all" group is server markup; toggle it in place rather than
    // re-rendering it from the client.
    const allGroup = containerRef.current?.querySelector<HTMLElement>(
      '[data-category="all"]',
    );
    if (allGroup) allGroup.hidden = slug !== "all";

    if (slug !== "all" && groups[slug]?.status !== "ready") load(slug);
  }

  const activeGroup = active === "all" ? undefined : groups[active];

  // DESIGN.md §7b chip swap back to "all": the server group is un-hidden in
  // place, so fade its tiles here. Every other group fades on mount, inside
  // the lazy chunk above; keyed by slug, a cached group remounts on a swap.
  useLayoutEffect(() => {
    const previous = previousActiveRef.current;
    previousActiveRef.current = active;
    if (active !== "all" || previous === "all") return;
    const allGroup = containerRef.current?.querySelector<HTMLElement>(
      '[data-category="all"]',
    );
    if (allGroup)
      fadeInSwappedItems(allGroup.querySelectorAll(":scope > ul > li"));
  }, [active]);

  return (
    <>
      {/* Below `sm` the chips form one left-aligned scroll row instead of
          wrapping 3/3/1. The row bleeds through the 24px gutter to the screen
          edge (same as the hero chips) so a cropped chip signals more. Its
          6px vertical padding keeps focus rings unclipped; 6px less top
          margin keeps the visual gap. */}
      <ChipRow className="mt-6 justify-center max-sm:-mx-6 max-sm:mt-4.5 max-sm:scroll-px-6 max-sm:snap-x max-sm:flex-nowrap max-sm:justify-start max-sm:overflow-x-auto max-sm:px-6 max-sm:py-1.5">
        {categories.map((cat) => (
          <ToggleChip
            key={cat.slug}
            pressed={active === cat.slug}
            onPressedChange={() => handleSelect(cat.slug)}
            className={cn(
              "shrink-0 snap-start",
              active !== cat.slug &&
                "border-on-ink/40 text-on-ink hover:border-on-ink hover:bg-white/10 hover:text-on-ink",
            )}
          >
            {cat.label}
          </ToggleChip>
        ))}
      </ChipRow>

      <div ref={containerRef}>
        {children}
        {active === "all" ? null : activeGroup?.status === "ready" ? (
          <WallGroupGrid
            key={active}
            slug={active}
            slots={activeGroup.slots}
            locale={locale}
            labels={labels.tile}
          />
        ) : activeGroup?.status === "error" ? (
          <div
            data-category={active}
            className="mt-8 flex flex-col items-center gap-4 text-center"
          >
            <p role="alert" className="type-body">
              {labels.loadFailed}
            </p>
            <Button
              variant="secondary"
              shape="pill"
              className="focus-visible:ring-on-ink focus-visible:ring-offset-surface-dark"
              onClick={() => {
                // Retrying unmounts this button. Hand focus back to the
                // pressed chip — the reader's place in the filter — instead of
                // letting it fall to <body>.
                containerRef.current?.previousElementSibling
                  ?.querySelector<HTMLElement>('[aria-pressed="true"]')
                  ?.focus();
                load(active);
              }}
            >
              {labels.retry}
            </Button>
          </div>
        ) : (
          <WallGroupPlaceholder slug={active} />
        )}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {activeGroup?.status === "loading" ? labels.loading : ""}
      </span>
    </>
  );
}
