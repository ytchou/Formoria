import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StoryRow } from "@/components/stories/story-row";
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

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 3600;

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
  const ungrouped: StoryEntry[] = [
    ...series
      .filter((group) => group.stories.length < 2)
      .flatMap((group) => group.stories),
    ...standalone,
  ];

  return (
    <main className="page-gutter mx-auto w-full page-measure pt-12 pb-section">
      <div className="space-y-stack">
        <header className="max-w-[46rem] space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="type-body text-ink-soft">{t("subheading")}</p>
        </header>

        {!storyResult.ok ? (
          <div
            role="alert"
            className="flex min-h-[40vh] items-center justify-center rounded-[3px] border border-rule bg-surface px-6 py-16 text-center"
          >
            <p className="type-card-title text-ink-muted">{t("loadError")}</p>
          </div>
        ) : stories.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-[3px] border border-rule bg-surface px-6 py-16 text-center">
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

              return (
                <section
                  key={group.id}
                  aria-labelledby={headingId}
                  className="space-y-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={headingId} className="type-section">
                      {group.title}
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
                  <div className="divide-y divide-rule border-y border-rule">
                    {group.stories.map((story) => (
                      <StoryRow
                        key={story.slug}
                        story={story}
                        locale={locale}
                        headingLevel={3}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {ungrouped.length > 0 && (
              <section className="divide-y divide-rule border-y border-rule">
                {ungrouped.map((story) => (
                  <StoryRow
                    key={story.slug}
                    story={story}
                    locale={locale}
                    headingLevel={2}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
