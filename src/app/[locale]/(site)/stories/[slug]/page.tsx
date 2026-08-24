import type { Metadata } from "next";
import {
  EditorialHero,
  editorialHeroSrc,
} from "@/components/ui/editorial-hero";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/ui/page-shell";
import {
  getAllStories,
  getPublishedStoryBySlug,
  getStorySeries,
  type StoryLocale,
} from "@/lib/services/stories";
import { FaqBlock } from "@/components/stories/faq-block";
import { SeriesNav } from "@/components/stories/series-nav";
import {
  formatStoryDate,
  toStoryIsoDate,
} from "@/components/stories/story-date";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import {
  extractLinkedBrandSlugs,
  hasEventInfoShortcode,
} from "@/lib/mdx/extract-brand-slugs";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import {
  categoryLabel,
  L1_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import { StoryContent } from "./story-content";
import { routes } from "@/lib/routes";

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const revalidate = 3600;

// Prebuild every published story so the first production visit is served from the
// ISR cache instead of paying on-demand generation. Locale comes from the parent
// `[locale]` layout's own `generateStaticParams`, so both locales are covered.
// `getAllStories()` is the same published set the index and sitemap use; anything
// outside it (drafts, future non-zh-TW stories) still renders on demand.
// Deliberately no `dynamic = 'force-static'`: it strips request-scoped state, so
// next-intl's `getRequestLocale()` returns undefined and `src/i18n/request.ts`
// silently falls back to zh-TW on on-demand/ISR renders while `params.locale`
// still says `en`. `revalidate` + `generateStaticParams` gives SSG+ISR without it.
export async function generateStaticParams() {
  // Story shortcodes can read the DB while rendering; defer them in E2E builds
  // so an unrelated prerender cannot prevent the selected journey from starting.
  if (process.env.PLAYWRIGHT_TEST === "true") return [];

  const result = await getAllStories();
  if (!result.ok) return [];
  // `story.slug` is the filename stem, which is what the route param resolves against
  // (`getPublishedStoryBySlug` reads `content/stories/<param>.mdx`); `frontmatter.slug`
  // is only used for canonical URLs and may diverge.
  return result.stories.map((story) => ({ slug: story.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  const story = await getPublishedStoryBySlug(slug);

  if (!story) {
    notFound();
  }

  // Canonical is pinned to 'zh-TW' on BOTH routes, deliberately not `safeLocale`:
  // until English editions exist, `/en/stories/<slug>` serves byte-identical zh-TW
  // body copy, so a self-referencing canonical there would enter the index as a
  // duplicate of the prefix-free URL. `buildAlternates` is shared with /brands and
  // must stay locale-agnostic — the zh-TW-only decision belongs at this call site.
  const { canonical, languages } = buildAlternates(
    routes.story(story.entry.frontmatter.slug),
    "zh-TW",
    ["zh-TW"],
  );

  // Per-story share card. Every page currently shares the site-wide default
  // from `src/app/opengraph-image.tsx`, so a story link in a group chat looks
  // identical to a link to the homepage. When the story declares a hero image,
  // that image becomes the card on both networks.
  //
  // `openGraph` is redeclared in full rather than patched: Next merges metadata
  // shallowly at the top level, so naming the key here replaces the locale
  // layout's whole object (siteName, type, locale). `/brands/[slug]` restates
  // the same fields for the same reason. Both keys are omitted entirely when
  // there is no hero image, which is what leaves the inherited default intact.
  const heroImage = story.entry.frontmatter.heroImage;
  const ogLocale = locale === "en" ? "en_US" : "zh_TW";

  return {
    title: story.entry.frontmatter.title,
    description: story.entry.frontmatter.description,
    alternates: { canonical, languages },
    ...(heroImage
      ? {
          openGraph: {
            siteName: "Formoria",
            type: "article" as const,
            locale: ogLocale,
            title: story.entry.frontmatter.title,
            description: story.entry.frontmatter.description,
            url: canonical,
            images: [
              {
                url: heroImage,
                // Falls back to the title here, unlike the in-page `<img>`:
                // an og:image alt is read in a preview card that carries no
                // other context, so repeating the title beats an empty string.
                alt:
                  story.entry.frontmatter.heroImageAlt ??
                  story.entry.frontmatter.title,
              },
            ],
          },
          twitter: {
            title: story.entry.frontmatter.title,
            description: story.entry.frontmatter.description,
            images: heroImage,
          },
        }
      : {}),
  };
}

export default async function StoryPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const story = await getPublishedStoryBySlug(slug);

  if (!story) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "stories" });

  // Siblings are resolved against the story's OWN authored locale, not the request
  // locale: `/en` serves the zh-TW document, so asking for the (empty) `en` set here
  // would silently drop the series nav on exactly that route.
  const seriesId = story.entry.frontmatter.series;
  const authoredLocale: StoryLocale =
    story.entry.frontmatter.locale === "en" ? "en" : "zh-TW";
  const seriesResult = seriesId
    ? await getStorySeries(seriesId, authoredLocale)
    : null;
  const series = seriesResult?.ok ? seriesResult.stories : [];

  // Resolved ONCE, and the same answer the hero renders from: an image the page
  // cannot display must not be published as the article's image either. `null`
  // is exactly the case where `EditorialHero` renders nothing.
  const heroSrc = editorialHeroSrc(story.entry.frontmatter.heroImage);
  const articleJsonLd = buildArticleJsonLd({
    title: story.entry.frontmatter.title,
    description: story.entry.frontmatter.description ?? "",
    path: routes.story(story.entry.frontmatter.slug),
    locale: safeLocale,
    author: story.entry.frontmatter.author ?? t("byline"),
    // The story has carried a mandatory hero since it launched and never
    // emitted one into structured data. `buildArticleJsonLd` absolutises a repo
    // path.
    image: heroSrc,
  });
  // Both are omitted rather than emitted raw when the frontmatter date is
  // missing or unparseable: schema.org date properties must be ISO-8601, and an
  // empty (or JS `Date.toString()`) value is reported as invalid by Google.
  const datePublished = toStoryIsoDate(story.entry.frontmatter.publishedAt);
  const dateModified = toStoryIsoDate(story.entry.frontmatter.updatedAt);
  // Reader-facing date for the byline. Same formatter the series nav and the
  // event page's story cards use, so one story never shows two date formats.
  const publishedLabel = formatStoryDate(
    story.entry.frontmatter.publishedAt,
    safeLocale,
  );
  const updatedLabel =
    formatStoryDate(story.entry.frontmatter.updatedAt, safeLocale) ??
    publishedLabel;
  const storyTags = Array.from(new Set(story.entry.frontmatter.tags))
    .map((tag) => {
      if (tag === "event") return { key: tag, label: t("tags.event") };
      if (tag === "creative-expo")
        return { key: tag, label: t("tags.creative-expo") };
      const category = L1_CATEGORIES.find(
        (item) => item.slug === tag,
      );
      return category
        ? { key: tag, label: categoryLabel(category, safeLocale) }
        : null;
    })
    .filter((tag): tag is { key: string; label: string } => tag !== null);
  const seriesTitle =
    story.entry.frontmatter.seriesTitle ??
    series.find((entry) => entry.frontmatter.seriesTitle)?.frontmatter
      .seriesTitle ??
    t("seriesHeading");
  // Mirrors the visible breadcrumb below, so the two never disagree. Same
  // builder every other content route uses (`/brands/[slug]`, `/events`).
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [
      { label: t("breadcrumb"), href: routes.stories() },
      { label: story.entry.frontmatter.title },
    ],
    safeLocale,
  );
  // The shortcodes only resolve inside `MDXRemote`, which renders after this
  // component returns, so the list size is read off the raw source. The *linked*
  // variant, not the guard's full one: `<BrandGallery>` names a brand but renders
  // photos with no click path, so its slugs would be impressions that can never
  // convert. Zero brands means no list at all — an empty `view_item_list` is
  // noise in GA4, not a datapoint.
  const brandCount = extractLinkedBrandSlugs(story.content).length;
  const hasEventInfo = hasEventInfoShortcode(story.content);

  return (
    // One container owns every story detail surface: breadcrumb, hero,
    // metadata, body, figures, cards, FAQ, and series nav. It runs on
    // `prose-measure`, the named reading width, rather than the 920px literal
    // that used to sit here — a reading page states which of the three measures
    // it is, and the number itself stays in `globals.css` where one edit reaches
    // every reading surface at once.
    <PageShell as="main" measure="prose" className="pt-8 pb-16 md:pt-12 md:pb-24">
      <nav aria-label={t("breadcrumbAria")} className="mb-6">
        <ol className="flex items-center gap-1.5 type-body-sm">
          <li>
            {/* A raw `<a>`, not next/link. DEV-1280: full-document navigation avoids a
              stalled RSC request across the locale proxy rewrite. The
              `no-html-link-for-pages` suppression that used to sit here is gone with
              the literal href — the rule only inspects string literals, so routing
              this through `@/lib/routes` left the directive unused, which
              `reportUnusedDisableDirectives: "error"` fails on. */}
            <a
              href={routes.stories()}
              className="hover:text-ink transition-colors"
            >
              {t("breadcrumb")}
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <span aria-current="page" className="text-ink">
              {story.entry.frontmatter.title}
            </span>
          </li>
        </ol>
      </nav>
      <article className="space-y-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify({
              ...articleJsonLd,
              ...(datePublished ? { datePublished } : {}),
              ...(dateModified ? { dateModified } : {}),
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(breadcrumbJsonLd),
          }}
        />
        {brandCount > 0 ? (
          <ViewItemListTracker
            listName={`story:${slug}`}
            itemCount={brandCount}
          />
        ) : null}
        {/*
          Lead image, above the title the way a feature opens in print. Full
          container width and 16:9 rather than the capped 4:3 used by inline
          `<Figure>`s: this one is not illustrating a paragraph, it is the
          story's opening frame, and the wide crop keeps it from eating the
          fold on a laptop.

          `EditorialHero` owns the box, the LCP hints and the "can this be
          displayed" question — trail detail opens with the same frame, and the
          two copies had already drifted apart on the placeholder colour.
        */}
        <EditorialHero
          src={story.entry.frontmatter.heroImage}
          alt={story.entry.frontmatter.heroImageAlt ?? ""}
        />
        <header className="space-y-4">
          <h1 className="type-page-title">
            {story.entry.frontmatter.title}
          </h1>
          <p className="type-body text-ink-soft">
            {story.entry.frontmatter.description}
          </p>
          {/* The byline sits under a hairline, the way a feature's credits do in
              print: it is the boundary between the opening and the article, not
              a caption on the title. */}
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-rule pt-4 type-metadata">
            <div className="contents">
              <dt className="border-r border-rule pr-3 type-metadata">
                {t("authorLabel")}
              </dt>
              <dd>{story.entry.frontmatter.author ?? t("byline")}</dd>
            </div>
            {seriesId && series.length >= 2 ? (
              <div className="contents">
                <dt className="border-r border-rule pr-3 type-metadata">
                  {t("seriesLabel")}
                </dt>
                <dd>
                  {/* Metadata navigation follows the breadcrumb treatment, not body-prose link styling. */}
                  <a
                    href="#series"
                    className="rounded-control hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {seriesTitle}
                  </a>
                </dd>
              </div>
            ) : null}
            {publishedLabel ? (
              <div className="contents">
                <dt className="border-r border-rule pr-3 type-metadata">
                  {t("publishedLabel")}
                </dt>
                <dd>{publishedLabel}</dd>
              </div>
            ) : null}
            {updatedLabel && updatedLabel !== publishedLabel ? (
              <div className="contents">
                <dt className="border-r border-rule pr-3 type-metadata">
                  {t("lastUpdatedLabel")}
                </dt>
                <dd>{updatedLabel}</dd>
              </div>
            ) : null}
            {storyTags.length > 0 ? (
              <div className="contents">
                <dt className="border-r border-rule pr-3 type-metadata">
                  {t("tagsLabel")}
                </dt>
                <dd className="min-w-0">
                  <div
                    className="flex flex-wrap items-center gap-2"
                    aria-label={t("tagsAria")}
                  >
                    {storyTags.map((tag) => (
                      <Badge key={tag.key} variant="secondary">
                        {tag.label}
                      </Badge>
                    ))}
                  </div>
                </dd>
              </div>
            ) : null}
          </dl>
        </header>
        {/*
          No `prose` classes: the Tailwind typography plugin is not installed,
          so they were inert. Story typography comes from the element map in
          `storyComponentMap` (src/lib/mdx/components.ts), built on the
          project's own `type-*` scale.
        */}
        {/*
          Embedded `<BrandCard>`s carry a save button, which reads `useSavedBrands`.
          The hook degrades to a no-op without a provider, so this is what makes the
          buttons live for signed-in readers while leaving signed-out ones untouched;
          the provider seeds itself from `getSavedBrandIdsAction` once a session exists.
          Scoped to the MDX body — nothing else on the page saves anything.
        */}
        <SavedBrandsProvider>
          <div>
            <StoryContent
              source={story.content}
              currentStorySlug={story.entry.slug}
            />
          </div>
        </SavedBrandsProvider>
        {story.entry.frontmatter.faq &&
          story.entry.frontmatter.faq.length > 0 && (
            <FaqBlock questions={story.entry.frontmatter.faq} />
          )}
        {seriesId && !hasEventInfo ? (
          <SeriesNav
            series={series}
            currentSlug={story.entry.slug}
            locale={safeLocale}
          />
        ) : null}
      </article>
    </PageShell>
  );
}
