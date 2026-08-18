import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { StoryRow } from "@/components/stories/story-row";
import { markRenderDegraded } from "@/lib/degraded-render";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { getIndexableTrailSlugs } from "@/lib/services/trail-supply";
import { type TrailEntry, type TrailListResult } from "@/lib/services/trails";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 3600;

const TRAIL_TAGS = new Set<string>(PRODUCT_TYPE_CATEGORIES.map((category) => category.slug));

export function filterTrailsByTag(
  trails: TrailEntry[],
  requestedTag: string | null,
): TrailEntry[] {
  if (!requestedTag || !TRAIL_TAGS.has(requestedTag)) return trails;
  return trails.filter((trail) => trail.frontmatter.tags.includes(requestedTag));
}

export function shouldIndexTrailHub(indexableSlugs: ReadonlySet<string>): boolean {
  return indexableSlugs.size > 0;
}

export type HubView =
  | { kind: "loadError" }
  | { kind: "comingSoon" }
  | { kind: "list"; trails: TrailEntry[] };

/**
 * Decides exactly what the hub body renders. Pure so the supply gate is
 * testable without a render: an under-supplied trail is not just noindex, it is
 * absent from the list, which is what keeps the hub honest on an empty
 * production database.
 */
export function selectHubView({
  result,
  indexableSlugs,
  failedSlugs,
  activeTag,
}: {
  result: TrailListResult;
  indexableSlugs: ReadonlySet<string>;
  failedSlugs: ReadonlySet<string>;
  activeTag: string | null;
}): HubView {
  if (!result.ok) return { kind: "loadError" };

  // Every supply read failed: the trail list itself loaded (it is MDX on disk),
  // so "no supply" is indistinguishable from a database outage unless we say so.
  // Telling visitors there is nothing here would be a lie; surface the same
  // load error the list-read failure uses.
  if (
    result.trails.length > 0 &&
    result.trails.every((trail) => failedSlugs.has(trail.slug))
  ) {
    return { kind: "loadError" };
  }

  const trails = filterTrailsByTag(result.trails, activeTag).filter((trail) =>
    indexableSlugs.has(trail.slug),
  );

  return trails.length === 0 ? { kind: "comingSoon" } : { kind: "list", trails };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "discover" });
  const { indexableSlugs } = await getIndexableTrailSlugs(safeLocale);
  const { canonical, languages } = buildAlternates("/discover", "zh-TW", ["zh-TW"]);

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
    ...(!shouldIndexTrailHub(indexableSlugs)
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
  const { result, indexableSlugs, failedSlugs, degraded } =
    await getIndexableTrailSlugs(safeLocale);
  if (degraded) await markRenderDegraded("discover.hub");
  const view = selectHubView({ result, indexableSlugs, failedSlugs, activeTag });

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
