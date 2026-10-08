"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import { Button } from "@/components/ui/button";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import type { AppLocale } from "@/i18n/locale-preference";
import type { WallTileSlot } from "@/lib/curated-products/wall-tile";
import { fadeInSwappedItems } from "@/lib/motion/chip-swap";
import { WallGroupPlaceholder } from "./wall-group";

/**
 * Click-gated (DEV-1972): the tile and everything it imports (the taxonomy
 * ontology among them) reach the browser on the first category chip, never in
 * the homepage's initial bundle. The server renders the "all" group through
 * the same component, so a fetched group is markup-identical to it.
 */
const loadWallGroupGrid = () =>
  import("./wall-group-grid").then((m) => m.WallGroupGrid);

const WallGroupGrid = dynamic(loadWallGroupGrid, {
  ssr: false,
  loading: () => <WallGroupPlaceholder />,
});

type CategoryOption = {
  slug: string;
  label: string;
};

export type CategoryFilterLabels = {
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
  // The group last faded in. Starts at the server-rendered "all" group so the
  // page load is never animated (DESIGN.md §7b reserves entrance for the hero).
  const revealedRef = useRef<string | null>("all");

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
  const activeStatus = activeGroup?.status;

  // DESIGN.md §7b chip swap: fade the incoming group's tiles in once they are
  // on screen — at once for "all" or a cached group, on arrival for a fetched
  // one. The placeholder and the error block are never faded.
  useLayoutEffect(() => {
    if (active !== "all" && activeStatus !== "ready") {
      revealedRef.current = null;
      return;
    }
    if (revealedRef.current === active) return;
    revealedRef.current = active;
    const group = Array.from(containerRef.current?.children ?? []).find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        el.dataset.category === active &&
        !el.hidden,
    );
    if (group) fadeInSwappedItems(group.querySelectorAll(":scope > ul > li"));
  }, [active, activeStatus]);

  return (
    <>
      <ChipRow className="mt-6 justify-center">
        {categories.map((cat) => (
          <ToggleChip
            key={cat.slug}
            pressed={active === cat.slug}
            onPressedChange={() => handleSelect(cat.slug)}
            className={
              active !== cat.slug
                ? "border-on-ink/40 text-on-ink hover:border-on-ink hover:bg-white/10 hover:text-on-ink"
                : undefined
            }
          >
            {cat.label}
          </ToggleChip>
        ))}
      </ChipRow>

      <div ref={containerRef}>
        {children}
        {active === "all" ? null : activeGroup?.status === "ready" ? (
          <WallGroupGrid
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
