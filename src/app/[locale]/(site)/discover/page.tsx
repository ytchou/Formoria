import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { StoryRow } from "@/components/stories/story-row";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import {
  getAllTrails,
  type TrailEntry,
  type TrailListResult,
} from "@/lib/services/trails";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 3600;

const TRAIL_TAGS = new Set<string>(L1_CATEGORIES.map((category) => category.slug));

export function filterTrailsByTag(
  trails: TrailEntry[],
  requestedTag: string | null,
): TrailEntry[] {
  if (!requestedTag || !TRAIL_TAGS.has(requestedTag)) return trails;
  return trails.filter((trail) => trail.frontmatter.tags.includes(requestedTag));
}

export function shouldIndexTrailHub(trails: readonly TrailEntry[]): boolean {
  return trails.length > 0;
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
  const { canonical, languages } = buildAlternates("/discover", "zh-TW", ["zh-TW"]);

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
  const view = selectHubView({ result, activeTag });

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <div className="space-y-8">
        <header className="space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="max-w-2xl type-body-muted">{t("subheading")}</p>
        </header>
        {view.kind === "loadError" ? (
          <div
            role="alert"
            className="rounded-2xl border border-border bg-secondary px-6 py-16 text-center"
          >
            <p className="type-empty-title">{t("loadError")}</p>
          </div>
        ) : view.kind === "comingSoon" ? (
          <EmptyState icon={<Compass />} title={t("comingSoon")} />
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {view.trails.map((trail, index) => (
              <StoryRow
                key={trail.slug}
                story={trail}
                locale={locale}
                headingLevel={2}
                position={index}
                trackingSurface="discover_hub"
                trackingKind="trail"
                hrefBase="/discover"
                namespace="discover"
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
