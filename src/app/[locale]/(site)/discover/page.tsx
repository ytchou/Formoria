import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { StoryRow } from "@/components/stories/story-row";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { trailIndexBlockers } from "@/lib/seo/trail-indexability";
import {
  getAllTrails,
  type TrailEntry,
  type TrailListResult,
} from "@/lib/services/trails";
import { getPublishedCuratedProductsForTrail } from "@/lib/services/curated-products";
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

type TrailIndexabilityResult = {
  result: TrailListResult;
  indexableSlugs: Set<string>;
  degraded: boolean;
};

const getTrailIndexability = cache(
  async (locale: Locale): Promise<TrailIndexabilityResult> => {
    const result = await getAllTrails(locale);
    if (!result.ok) {
      captureReadFailure("discover.hub.trails")(result.error);
      return { result, indexableSlugs: new Set(), degraded: true };
    }

    let degraded = false;

    const checks = await Promise.all(
      result.trails.map(async (trail) => {
        try {
          const products = await getPublishedCuratedProductsForTrail(trail.slug);
          return {
            slug: trail.slug,
            clear:
              trailIndexBlockers({ frontmatter: trail.frontmatter, products }).length ===
              0,
          };
        } catch (error) {
          degraded = true;
          captureReadFailure(`discover.hub.products.${trail.slug}`)(error);
          return { slug: trail.slug, clear: false };
        }
      }),
    );

    return {
      result,
      indexableSlugs: new Set(checks.filter((check) => check.clear).map((check) => check.slug)),
      degraded,
    };
  },
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "discover" });
  const { indexableSlugs } = await getTrailIndexability(safeLocale);
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
  const { result, degraded } = await getTrailIndexability(safeLocale);
  if (degraded) await markRenderDegraded("discover.hub");
  const trails = result.ok ? filterTrailsByTag(result.trails, activeTag) : [];

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <div className="space-y-8">
        <header className="space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="max-w-2xl type-body-muted">{t("subheading")}</p>
        </header>
        {!result.ok ? (
          <div
            role="alert"
            className="rounded-2xl border border-border bg-secondary px-6 py-16 text-center"
          >
            <p className="type-empty-title">{t("loadError")}</p>
          </div>
        ) : trails.length === 0 ? (
          <EmptyState icon={<Compass />} title={t("comingSoon")} />
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {trails.map((trail, index) => (
              <StoryRow
                key={trail.slug}
                story={trail}
                locale={locale}
                headingLevel={2}
                position={index}
                trackingSurface="discover"
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
