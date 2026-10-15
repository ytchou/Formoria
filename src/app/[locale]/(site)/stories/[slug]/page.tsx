import type { Metadata } from "next";
import { editorialHeroSrc } from "@/components/ui/editorial-hero";
import {
  EditorialHeader,
  type MetaItem,
} from "@/components/ui/editorial-header";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/ui/page-shell";
import {
  getPublishedStoryBySlug,
  getStorySeries,
  type StoryLocale,
} from "@/lib/services/stories";
import { FaqBlock } from "@/components/stories/faq-block";
import { SeriesNav } from "@/components/stories/series-nav";
import { StorySources } from "@/components/stories/story-sources";
import {
  formatStoryDate,
  toStoryIsoDate,
} from "@/components/stories/story-date";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { extractLinkedBrandSlugs } from "@/lib/mdx/extract-brand-slugs";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import { categoryLabel, L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { StoryContent } from "./story-content";
import { routes } from "@/lib/routes";
import { getStoryRelatedTrails } from "@/lib/services/editorial-links";
import { RelatedTrailLink } from "@/components/stories/related-story-link";
import { contentLangFor } from "@/lib/trails/content-lang";
import { captureReadFailure } from "@/lib/degraded-render";

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const revalidate = 0;

/**
 * The document title. On a page whose locale differs from the story's (every
 * /en story today), the title says the story is in Chinese; share cards keep
 * the bare title.
 */
export function storyDocumentTitle(
  title: string,
  contentLang: string | undefined,
  titleInChinese: (title: string) => string,
): string {
  return contentLang ? titleInChinese(title) : title;
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
  const t = await getTranslations({ locale, namespace: "stories" });
  const contentLang = contentLangFor(
    story.entry.frontmatter.locale,
    locale === "en" ? "en" : "zh-TW",
  );

  return {
    title: storyDocumentTitle(story.entry.frontmatter.title, contentLang, (title) =>
      t("titleInChinese", { title }),
    ),
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
  // Set when the story's language is not the page's (every /en story until
  // English editions exist): zh content is marked `lang`, UI labels are not.
  const contentLang = contentLangFor(story.entry.frontmatter.locale, safeLocale);

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
  // is exactly the case where `EditorialHeader` takes its imageless path.
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
  const authoredSeriesTitle =
    story.entry.frontmatter.seriesTitle ??
    series.find((entry) => entry.frontmatter.seriesTitle)?.frontmatter
      .seriesTitle;
  const seriesTitle = authoredSeriesTitle ?? t("seriesHeading");
  // Mirrors the visible breadcrumb below, so the two never disagree. Same
  // builder every other content route uses (`/brands/[slug]`).
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
  const relatedTrails =
    (await getStoryRelatedTrails(slug).catch(
      captureReadFailure("story.relatedTrails"),
    )) ?? [];
  // The story's byline as the trail's one meta line (DS-08), replacing the
  // five-row label table. The series is a link inside the line, to the
  // `#series` nav at the foot of the article; tags moved to the article
  // footer, where they label what was read rather than delaying the opening.
  const metaItems: MetaItem[] = [
    {
      label: t("authorLabel"),
      value: story.entry.frontmatter.author ?? t("byline"),
      // An authored byline is content; the fallback is UI copy.
      lang: story.entry.frontmatter.author ? contentLang : undefined,
    },
    ...(seriesId && series.length >= 2
      ? [
          {
            label: t("seriesLabel"),
            value: (
              // Metadata navigation follows the breadcrumb treatment, not body-prose link styling.
              <a
                href="#series"
                className="rounded-control hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span lang={authoredSeriesTitle ? contentLang : undefined}>
                  {seriesTitle}
                </span>
              </a>
            ),
          },
        ]
      : []),
    ...(publishedLabel
      ? [{ label: t("publishedLabel"), value: publishedLabel }]
      : []),
    ...(updatedLabel && updatedLabel !== publishedLabel
      ? [{ label: t("lastUpdatedLabel"), value: updatedLabel }]
      : []),
  ];
  return (
    // The header is the shared editorial frame (DS-08): full-bleed scene,
    // title, lede, one meta line — the same opening a trail has. The body runs
    // on `prose-measure`, the named reading width, rather than the 920px
    // literal that used to sit here — a reading page states which of the three
    // measures it is, and the number itself stays in `globals.css` where one
    // edit reaches every reading surface at once. Centered, so the margins
    // either side of the column stay free for hanging section markers.
    <main className="pb-16 md:pb-24">
      <article>
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
          The shared `Breadcrumb` (DS-25): padded link targets of 24px and up
          instead of the 17–21px raw `<a>` this page used to hand-roll, and
          next-intl `Link` with prefetch off, as on trail and brand detail. The
          raw `<a>` was a DEV-1280 workaround for a stalled RSC request across
          the locale proxy rewrite; trail detail has shipped the shared `Link`
          crumb without it.
        */}
        <EditorialHeader
          breadcrumbAriaLabel={t("breadcrumbAria")}
          breadcrumbItems={[
            { label: t("breadcrumb"), href: routes.stories() },
            { label: story.entry.frontmatter.title, lang: contentLang },
          ]}
          notice={contentLang ? t("untranslatedNotice") : null}
          hero={
            heroSrc
              ? {
                  src: heroSrc,
                  alt: story.entry.frontmatter.heroImageAlt ?? "",
                  quality: 60,
                }
              : null
          }
          title={story.entry.frontmatter.title}
          lede={story.entry.frontmatter.description}
          contentLang={contentLang}
          metaItems={metaItems}
        />
        <PageShell measure="prose" className="space-y-8 pt-10">
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
            <div lang={contentLang}>
              <StoryContent source={story.content} />
            </div>
          </SavedBrandsProvider>
          {relatedTrails.length > 0 ? (
            <nav aria-label={t("relatedTrailsAria")} className="space-y-3">
              <h2 className="type-card-title">{t("relatedTrails")}</h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
                {relatedTrails.map((trail, position) => (
                  <li key={trail.slug}>
                    <RelatedTrailLink
                      href={routes.trail(trail.slug)}
                      trailSlug={trail.slug}
                      position={position}
                      trailSurface="story_related_trails"
                      className="text-accent underline underline-offset-4 hover:text-ink"
                    >
                      {/* Trails are zh-TW content, like the story. */}
                      <span lang={contentLang}>{trail.title}</span>
                    </RelatedTrailLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {story.entry.frontmatter.faq &&
            story.entry.frontmatter.faq.length > 0 && (
              <FaqBlock
                questions={story.entry.frontmatter.faq}
                lang={contentLang}
              />
            )}
          <StorySources
            heading={t("sourcesHeading")}
            sources={story.entry.frontmatter.sources}
          />
          {storyTags.length > 0 ? (
            <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule pt-6">
              <span className="type-metadata">{t("tagsLabel")}</span>
              <div
                role="group"
                aria-label={t("tagsAria")}
                className="flex flex-wrap items-center gap-2"
              >
                {storyTags.map((tag) => (
                  <Badge key={tag.key} variant="secondary">
                    {tag.label}
                  </Badge>
                ))}
              </div>
            </footer>
          ) : null}
          {seriesId ? (
            <SeriesNav
              series={series}
              currentSlug={story.entry.slug}
              locale={safeLocale}
            />
          ) : null}
        </PageShell>
      </article>
    </main>
  );
}
