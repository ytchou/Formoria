import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { StoryRow } from "@/components/stories/story-row";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { shouldIndexTrailHub } from "@/lib/seo/trail-hub-indexability";
import { captureReadFailure } from "@/lib/degraded-render";
import {
  getAllTrails,
  type TrailEntry,
  type TrailListResult,
} from "@/lib/services/trails";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { routes } from "@/lib/routes";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export { shouldIndexTrailHub };

export const revalidate = 3600;

const TRAIL_TAGS = new Set<string>(L1_CATEGORIES.map((category) => category.slug));

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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "discover" });
  const result = await getAllTrails(safeLocale);
  const { canonical, languages } = buildAlternates(routes.discover(), "zh-TW", ["zh-TW"]);

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

export default async function DiscoverHubPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "discover" });
  const query = await searchParams;
  const activeTag = firstParam(query.tag);
  const result = await getAllTrails(safeLocale);
  // The trail list is MDX on disk, so a failed read is a real outage that still
  // serves a 200 with an error panel. Report it, or the outage is invisible:
  // `trailListError` only reaches `console.error`. Observability only — the hub
  // awaits `searchParams`, a Next 16 dynamic API, so the route is already
  // dynamic and there is no ISR entry for `markRenderDegraded` to opt out of.
  if (!result.ok) captureReadFailure("discover.hub.trails")(result.error);
  const view = selectHubView({ result, activeTag });

  return (
    <main className="page-gutter mx-auto w-full page-measure pt-12 pb-section">
      <div className="space-y-stack">
        <header className="max-w-[46rem] space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="type-body text-ink-soft">{t("subheading")}</p>
        </header>
        {view.kind === "loadError" ? (
          <div
            role="alert"
            className="rounded-[3px] border border-rule bg-surface px-6 py-16 text-center"
          >
            <p className="type-card-title text-ink-muted">{t("loadError")}</p>
          </div>
        ) : view.kind === "comingSoon" ? (
          <EmptyState icon={<Compass />} title={t("comingSoon")} />
        ) : (
          <div className="divide-y divide-rule border-y border-rule">
            {view.trails.map((trail, index) => (
              <StoryRow
                key={trail.slug}
                story={trail}
                locale={locale}
                headingLevel={2}
                position={index}
                trackingSurface="discover_hub"
                trackingKind="trail"
                hrefBase={routes.discover()}
                namespace="discover"
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
