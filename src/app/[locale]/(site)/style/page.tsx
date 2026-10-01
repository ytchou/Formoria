import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { TrailTile, type TrailTileLabels } from "@/components/landing/trail-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { gridStyles } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import { ChipRow, taxonomyLinkClasses } from "@/components/ui/toggle-chip";
import { Link } from "@/i18n/navigation";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { shouldIndexTrailHub } from "@/lib/seo/trail-hub-indexability";
import { captureReadFailure } from "@/lib/degraded-render";
import {
  getTrailPeekProducts,
  type CuratedProduct,
} from "@/lib/services/curated-products";
import {
  getAllTrails,
  type TrailEntry,
  type TrailListResult,
} from "@/lib/services/trails";
import { categoryLabel, VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { routes } from "@/lib/routes";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export { shouldIndexTrailHub };

export const revalidate = 3600;

const TRAIL_TAGS = new Set<string>(VISIBLE_L1_CATEGORIES.map((category) => category.slug));

export function filterTrailsByTag(
  trails: TrailEntry[],
  requestedTag: string | null,
): TrailEntry[] {
  if (!requestedTag || !TRAIL_TAGS.has(requestedTag)) return trails;
  return trails.filter((trail) => trail.frontmatter.tags.includes(requestedTag));
}

export type HubView =
  | { kind: "loadError" }
  | { kind: "comingSoon" }
  | { kind: "list"; trails: TrailEntry[] };

/**
 * Decides exactly what the hub body renders. Published is the only membership
 * test — trail quality is enforced when the trail is authored, so the hub reads
 * the MDX list and nothing else. `comingSoon` now means what it says: no trail
 * is published, or none carries the requested tag.
 */
export function selectHubView({
  result,
  activeTag,
}: {
  result: TrailListResult;
  activeTag: string | null;
}): HubView {
  if (!result.ok) return { kind: "loadError" };

  const trails = filterTrailsByTag(result.trails, activeTag);

  return trails.length === 0 ? { kind: "comingSoon" } : { kind: "list", trails };
}

export type HubTagChip = { slug: string; label: string };

/**
 * One chip per visible L1 that at least one published trail carries, in
 * ontology order. Built from the unfiltered list so the row stays put while a
 * tag is active.
 */
export function hubTagChips(trails: TrailEntry[], locale: string): HubTagChip[] {
  const inUse = new Set(trails.flatMap((trail) => trail.frontmatter.tags));
  return VISIBLE_L1_CATEGORIES.filter((category) => inUse.has(category.slug)).map(
    (category) => ({ slug: category.slug, label: categoryLabel(category, locale) }),
  );
}

/**
 * Peeks for the listed trails, or none. A failed read is reported and the hub
 * still lists every card — the peek is decoration, never a supply gate.
 * `read` is the service seam the hub test stubs without mocking a module.
 */
export async function readHubPeeks(
  slugs: string[],
  read: typeof getTrailPeekProducts = getTrailPeekProducts,
): Promise<Record<string, CuratedProduct[]>> {
  // uncached: one query per hub view; wrap in a tagged cache if hub traffic grows.
  const peeks = await read(slugs, 4).catch(captureReadFailure("style.hub.peeks"));
  return peeks ?? {};
}

/**
 * The filter lives in the query string, so the chips are links and work with
 * JS off. An unknown tag is ignored by the filter, so it leaves 全部 current.
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
  const current = activeTag && TRAIL_TAGS.has(activeTag) ? activeTag : null;
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

export function HubTrailGrid({
  trails,
  peeks,
  labels,
}: {
  trails: TrailEntry[];
  peeks: Record<string, CuratedProduct[]>;
  labels: TrailTileLabels;
}) {
  return (
    <ul className={gridStyles({ cols: "pair" })}>
      {trails.map((trail, index) => (
        <TrailTile
          key={trail.slug}
          trail={trail}
          position={index}
          trailSurface="style_hub"
          headingLevel="h2"
          peek={peeks[trail.slug]}
          labels={labels}
        />
      ))}
    </ul>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "style" });
  const result = await getAllTrails(safeLocale);
  const { canonical, languages } = buildAlternates(routes.style(), "zh-TW", ["zh-TW"]);

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
    ...(!shouldIndexTrailHub(result.ok ? result.trails : [])
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

function firstParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value.at(0) : value;
  return candidate?.trim() || null;
}

export default async function StyleHubPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "style" });
  const query = await searchParams;
  const activeTag = firstParam(query.tag);
  const result = await getAllTrails(safeLocale);
  // The trail list is MDX on disk, so a failed read is a real outage that still
  // serves a 200 with an error panel. Report it, or the outage is invisible:
  // `trailListError` only reaches `console.error`. Observability only — the hub
  // awaits `searchParams`, a Next 16 dynamic API, so the route is already
  // dynamic and there is no ISR entry for `markRenderDegraded` to opt out of.
  if (!result.ok) captureReadFailure("style.hub.trails")(result.error);
  const view = selectHubView({ result, activeTag });
  const [tCommon, tLanding, peeks] = await Promise.all([
    getTranslations({ locale, namespace: "common" }),
    getTranslations({ locale, namespace: "landing" }),
    // No slugs, no query: the service answers `{}` without a round trip.
    readHubPeeks(
      view.kind === "list" ? view.trails.map((trail) => trail.slug) : [],
    ),
  ]);
  const tagChips = result.ok ? hubTagChips(result.trails, locale) : [];

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <div className="space-y-stack">
        <header className="prose-measure space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="type-body">{t("subheading")}</p>
        </header>
        {tagChips.length > 0 ? (
          <HubTagChipRow
            chips={tagChips}
            activeTag={activeTag}
            allLabel={tCommon("all")}
          />
        ) : null}
        {view.kind === "loadError" ? (
          <div
            role="alert"
            className="rounded-surface border border-rule bg-surface px-6 py-16 text-center"
          >
            <p className="type-card-title text-ink-muted">{t("loadError")}</p>
          </div>
        ) : view.kind === "comingSoon" ? (
          <EmptyState icon={<Compass />} title={t("comingSoon")} />
        ) : (
          <HubTrailGrid
            trails={view.trails}
            peeks={peeks}
            labels={{
              eyebrow: tLanding("trails.eyebrow"),
              cta: tLanding("trails.cta"),
            }}
          />
        )}
      </div>
    </PageShell>
  );
}
