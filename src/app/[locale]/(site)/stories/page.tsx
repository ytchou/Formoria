import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StoryCard } from "@/components/landing/story-card";
import { gridStyles } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import {
  getAllStories,
  getStoriesByTag,
  groupStoriesBySeries,
} from "@/lib/services/stories";
import type { StoryEntry } from "@/lib/services/stories";
import { isStoryTag } from "@/lib/taxonomy/story-tags";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { routes } from "@/lib/routes";
import { toStoryCard } from "@/lib/stories/story-card";
import { contentLangFor } from "@/lib/trails/content-lang";
import { cn } from "@/lib/utils";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 3600;

/**
 * The number in a series card's `seriesPart` label: the authored `seriesOrder`, else
 * the card's position in its band. Same key `groupStoriesBySeries` sorts by, so
 * the label and the order cannot disagree when every member declares one.
 */
export function seriesPartOrder(story: StoryEntry, index: number): number {
  return story.frontmatter.seriesOrder ?? index + 1;
}

/**
 * Ungrouped stories newest first: the head becomes the hub's full-width feature.
 * Re-sorted here because single-member series are folded in ahead of the
 * standalone set. ISO dates compare lexically; a copy, never in place.
 */
export function orderUngrouped(stories: StoryEntry[]): StoryEntry[] {
  return [...stories].sort((a, b) =>
    b.frontmatter.publishedAt.localeCompare(a.frontmatter.publishedAt),
  );
}

/** The label line above a hub card: series part, and "In Chinese" off-locale. */
function CardLabel({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null;
  return <p className="mb-2 type-metadata">{parts.join(" · ")}</p>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "stories" });
  const { canonical, languages } = buildAlternates(
    routes.stories(),
    "zh-TW",
    ["zh-TW"],
  );

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
  };
}

export default async function StoriesHubPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "stories" });
  const sp = await searchParams;
  const requestedTag =
    typeof sp.tag === "string" && sp.tag.trim() ? sp.tag.trim() : null;
  const activeTag =
    requestedTag && isStoryTag(requestedTag) ? requestedTag : null;
  const storyResult = activeTag
    ? await getStoriesByTag(activeTag, safeLocale)
    : await getAllStories(safeLocale);
  const stories = storyResult.ok ? storyResult.stories : [];
  // Grouping and ordering live in the service (`groupStoriesBySeries`), which is
  // also what `getStorySeries` orders by — one definition of "series order", not
  // one here and one there.
  const { series, standalone } = groupStoriesBySeries(stories, safeLocale);
  // A group down to a single visible entry gets no titled section, matching
  // `SeriesNav`, which renders nothing below two members. Its story still shows
  // — it just joins the ungrouped grid instead of sitting alone under a heading.
  const seriesSections = series.filter((group) => group.stories.length >= 2);
  const ungrouped = orderUngrouped([
    ...series
      .filter((group) => group.stories.length < 2)
      .flatMap((group) => group.stories),
    ...standalone,
  ]);
  // `StoryCard` marks the title and excerpt with `contentLang`; a zh-TW story on
  // /en also says so in the label line above it.
  const languageLabel = (story: StoryEntry) =>
    story.frontmatter.locale !== locale ? [t("languageBadge")] : [];
  // One rank across the whole hub, in render order, for `story_card_clicked`.
  const cardPosition = new Map(
    [...seriesSections.flatMap((group) => group.stories), ...ungrouped].map(
      (story, index) => [story.slug, index],
    ),
  );

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <div className="space-y-stack">
        <header className="prose-measure space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="type-body">{t("subheading")}</p>
        </header>

        {!storyResult.ok ? (
          <div
            role="alert"
            className="flex min-h-[40vh] items-center justify-center rounded-surface border border-rule bg-surface px-6 py-16 text-center"
          >
            <p className="type-card-title text-ink-muted">{t("loadError")}</p>
          </div>
        ) : stories.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-surface border border-rule bg-surface px-6 py-16 text-center">
            <p className="type-body-sm">{t("comingSoon")}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {seriesSections.map((group, index) => {
              const headingId = `story-series-${index}`;
              // Under a tag filter the visible members are a subset of the
              // series, so a bare count contradicts `SeriesNav` on the detail
              // page, which always reports the full series. Say "N of M" instead.
              const isPartial = group.stories.length !== group.totalCount;
              // The series title is authored copy in the stories' language.
              // On /en that is zh-TW (no English editions yet), so mark it as
              // such. The span keeps `lang` off the count beside it, which is
              // page-locale text.
              const groupLocale = group.stories[0]?.frontmatter.locale;
              const titleLang =
                groupLocale && groupLocale !== locale ? groupLocale : undefined;

              return (
                <section
                  key={group.id}
                  aria-labelledby={headingId}
                  className="space-y-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={headingId} className="type-section">
                      <span lang={titleLang}>{group.title}</span>
                    </h2>
                    <p className="type-metadata">
                      {isPartial
                        ? t("seriesCountFiltered", {
                            shown: group.stories.length,
                            total: group.totalCount,
                          })
                        : t("seriesCount", { count: group.stories.length })}
                    </p>
                  </div>
                  <div className={gridStyles({ cols: "pair" })}>
                    {group.stories.map((story, storyIndex) => (
                      <div key={story.slug}>
                        <CardLabel
                          parts={[
                            t("seriesPart", {
                              order: seriesPartOrder(story, storyIndex),
                            }),
                            ...languageLabel(story),
                          ]}
                        />
                        <StoryCard
                          story={toStoryCard(story)}
                          locale={locale}
                          position={cardPosition.get(story.slug) ?? 0}
                          trackingSurface="stories_hub"
                          contentLang={contentLangFor(
                            story.frontmatter.locale,
                            locale,
                          )}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {/*
              No section heading: the `stories` namespace has no key for it, and
              each card already carries its own h3.
            */}
            {ungrouped.length > 0 && (
              <section className={gridStyles({ cols: "pair" })}>
                {ungrouped.map((story, storyIndex) => (
                  // The newest ungrouped story leads as a full-width feature.
                  <div
                    key={story.slug}
                    className={cn(storyIndex === 0 && "md:col-span-2")}
                  >
                    <CardLabel parts={languageLabel(story)} />
                    <StoryCard
                      story={toStoryCard(story)}
                      locale={locale}
                      position={cardPosition.get(story.slug) ?? 0}
                      trackingSurface="stories_hub"
                      contentLang={contentLangFor(
                        story.frontmatter.locale,
                        locale,
                      )}
                    />
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
