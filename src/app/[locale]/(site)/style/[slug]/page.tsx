import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/brands/brand-breadcrumb";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import {
  TrailTile,
  type TrailTileLabels,
} from "@/components/landing/trail-tile";
import { RelatedStoryLink } from "@/components/stories/related-story-link";
import { formatStoryDate } from "@/components/stories/story-date";
import { editorialHeroSrc } from "@/components/ui/editorial-hero";
import { PageShell } from "@/components/ui/page-shell";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import {
  contentLangFor,
  getAllTrails,
  getPublishedTrailBySlug,
  resolveRelated,
  type TrailEntry,
  type TrailDetailResult,
} from "@/lib/services/trails";
import { getAllStories, type StoryEntry } from "@/lib/services/stories";
import {
  getPublishedCuratedProductsForTrail,
  type TrailCuratedProduct,
} from "@/lib/services/curated-products";
import { TrailContent } from "./trail-content";
import { routes } from "@/lib/routes";
import { findSimilarProductsForTrail } from "@/lib/services/product-situation-search";
import { ProductCard } from "@/components/products/product-card";
import { SavedProductsProvider } from "@/hooks/use-saved-products";
import { Grid, gridStyles } from "@/components/ui/grid";
import { IMAGE_SURFACE_SIZES, SurfaceImage } from "@/components/ui/image";

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const revalidate = 3600;

const getTrailPageData = cache(
  async (
    slug: string,
  ): Promise<{
    trail: TrailDetailResult | null;
    products: TrailCuratedProduct[] | null;
  }> => {
    const [trail, products] = await Promise.all([
      getPublishedTrailBySlug(slug),
      getPublishedCuratedProductsForTrail(slug).catch(
        captureReadFailure("style.trail.products"),
      ),
    ]);
    return { trail, products };
  },
);

export function buildTrailMetadata({
  locale,
  trail,
  sectionLabel,
  titleInChinese,
  productsReadFailed = false,
}: {
  locale: string;
  trail: TrailEntry;
  /**
   * The localized section name (`style.metaTitle`). Required: the document
   * title names the section after the trail. The layout's `%s | Formoria`
   * template supplies the brand, so it is never added here.
   */
  sectionLabel: string;
  /**
   * The localized `style.titleInChinese` formatter. Required, not optional: a
   * caller that forgot it would silently drop the language marker. Applied only
   * when the trail's language differs from the page's (a zh-TW trail on /en),
   * so an English tab or result reads "<zh-TW title> (in Chinese)" rather than a bare
   * Chinese title with no warning (DS2-08).
   */
  titleInChinese: (title: string) => string;
  /** `products === null` from `getTrailPageData` — the read threw, see below. */
  productsReadFailed?: boolean;
}): Metadata {
  const safeLocale: Locale = locale === "en" ? "en" : "zh-TW";
  const path = routes.trail(trail.frontmatter.slug);
  const { canonical, languages } = buildAlternates(path, "zh-TW", ["zh-TW"]);
  // The share card is the trail's own hero, resolved by the same predicate the
  // page hero uses. `openGraph` is restated in full (siteName included) because
  // Next merges metadata shallowly: naming the key replaces the layout's whole
  // object. Without a hero, `images` and `twitter` are omitted so the inherited
  // site-wide default card stays in place — same shape as `stories/[slug]`.
  const heroSrc = editorialHeroSrc(trail.frontmatter.heroImage);
  const documentTitle = contentLangFor(trail.frontmatter.locale, safeLocale)
    ? titleInChinese(trail.frontmatter.title)
    : trail.frontmatter.title;

  return {
    // Document title only; share cards keep the bare trail title.
    title: `${documentTitle} | ${sectionLabel}`,
    description: trail.frontmatter.description,
    alternates: { canonical, languages },
    openGraph: {
      siteName: "Formoria",
      title: trail.frontmatter.title,
      description: trail.frontmatter.description,
      url: canonical,
      type: "article",
      locale: safeLocale === "en" ? "en_US" : "zh_TW",
      ...(heroSrc
        ? {
            images: [
              {
                url: heroSrc,
                // The title, not an empty string: a preview card carries no
                // other context for the image.
                alt: trail.frontmatter.heroImageAlt ?? trail.frontmatter.title,
              },
            ],
          }
        : {}),
    },
    ...(heroSrc
      ? {
          twitter: {
            title: trail.frontmatter.title,
            description: trail.frontmatter.description,
            images: heroSrc,
          },
        }
      : {}),
    // Failure, not scarcity — this is not the deleted supply floor. `null` means
    // the curated-product read threw, so the page renders zero tiles for a reason
    // that has nothing to do with the trail; indexing that is indexing an outage.
    // A read that succeeds and returns nothing is a published trail with an empty
    // shelf, and stays indexable, which is the whole point of moving quality to
    // authoring time.
    ...(productsReadFailed ? { robots: { index: false, follow: true } } : {}),
  };
}

// Empty params keep every trail on ISR, rendered on first request and cached
// until `revalidate`. Same shape as `brands/[slug]`, for a second reason that
// matters more here: enumerating trails made this route read the database during
// `next build`, and a failed read there calls `markRenderDegraded`, which
// demotes the route to dynamic for the whole deployment, costing
// `/style/[slug]` its ISR cache entirely. Returning no params removes the
// build-time read, so the route cannot be demoted by one.
//
// This was invisible until the first trail was published: while every trail was
// `draft: true` the list was empty anyway.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  // Already in hand and request-cached, so reading `products` here costs no extra
  // round trip: `getTrailPageData` is the same `cache`d call the page body makes.
  const [{ trail, products }, t] = await Promise.all([
    getTrailPageData(slug),
    getTranslations({ locale, namespace: "style" }),
  ]);

  if (!trail) notFound();

  return buildTrailMetadata({
    locale,
    trail: trail.entry,
    sectionLabel: t("metaTitle"),
    titleInChinese: (title) => t("titleInChinese", { title }),
    productsReadFailed: products === null,
  });
}

/*
 * No trust-label opt-in. A trail renders `mode="trail"`, and the tile gates the
 * label on `mode === "outbound"` (D11, the contrast rule: every tile in a trail
 * is selected, so the label would repeat and say nothing). The key it used to
 * read, `discover.selectedBadge`, was a different sentence from the selection
 * commitment `TrustLabel` owns, and is gone from both catalogues.
 */
function trailLabels(t: (key: string) => string): SelectedProductTileLabels {
  return {
    cta: t("productCta"),
    brandSiteCta: t("brandSiteCta"),
    unavailable: t("unavailable"),
    madeInTaiwan: t("madeInTaiwan"),
  };
}

type MetaItem = {
  label: string;
  value: ReactNode;
  /** The value's language when it is content, not UI (see `contentLangFor`). */
  lang?: string;
};

/**
 * The editorial frame — who chose this, when, how much of it there is — as ONE
 * interface-face line under the header (DS2-35): editorLabel · updatedLabel · selectionLabel + selectionSummary.
 * It replaced a three-row `<dl>` table that sat beside the title and stood as
 * tall as the hero. A `<p>` of label/value spans, because a `<dl>` cannot hold
 * the separators; the `·` between items is decoration and is hidden from
 * assistive tech, which reads each label straight into its value.
 */
function MetaLine({ items }: { items: MetaItem[] }) {
  if (items.length === 0) return null;
  return (
    <p className="type-metadata flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span>
            {item.label}{" "}
            <span lang={item.lang} className="text-ink">
              {item.value}
            </span>
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Related stories as text links, by title. Slugs are resolved against the
 * published list before this runs, so a draft or missing story never reaches
 * the reader as a raw slug.
 */
function relatedStoryLinks(
  title: string,
  stories: StoryEntry[],
  pageLocale: string,
): React.ReactNode {
  if (stories.length === 0) return null;
  return (
    <section aria-labelledby="stories-related" className="space-y-3">
      <h2 id="stories-related" className="type-card-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
        {stories.map((story, position) => (
          <li key={story.slug}>
            <RelatedStoryLink
              href={routes.story(story.slug)}
              storySlug={story.slug}
              position={position}
              storySurface="trail_related_stories"
              className="text-accent underline underline-offset-4 hover:text-ink"
            >
              <span lang={contentLangFor(story.frontmatter.locale, pageLocale)}>
                {story.frontmatter.title}
              </span>
            </RelatedStoryLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Related trails as the same image-led tiles the /style hub lists, so a
 * trail's onward links look like trails rather than a line of slugs.
 */
function relatedTrailTiles(
  title: string,
  trails: TrailEntry[],
  labels: TrailTileLabels,
): React.ReactNode {
  if (trails.length === 0) return null;
  return (
    <section aria-labelledby="trails-related" className="space-y-6">
      <h2 id="trails-related" className="type-card-title">
        {title}
      </h2>
      <ul className={gridStyles({ cols: "pair" })}>
        {trails.map((related, position) => (
          <TrailTile
            key={related.slug}
            trail={related}
            position={position}
            trailSurface="trail_related"
            headingLevel="h3"
            labels={labels}
          />
        ))}
      </ul>
    </section>
  );
}

export default async function StyleTrailPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const [t, tLanding, { trail, products }, trailList, storyList] =
    await Promise.all([
      getTranslations({ locale, namespace: "style" }),
      getTranslations({ locale, namespace: "landing" }),
      getTrailPageData(slug),
      getAllTrails(safeLocale),
      getAllStories(safeLocale),
    ]);

  if (!trail) notFound();
  if (products === null) await markRenderDegraded("style.trail.products");
  const safeProducts = products ?? [];
  const similarProducts =
    safeProducts.length > 0
      ? await findSimilarProductsForTrail(
          safeProducts.map((p) => p.id),
        ).catch(() => [])
      : [];

  const entry = trail.entry;
  const frontmatter = entry.frontmatter;
  const heroImage = frontmatter.heroImage;
  // Set only when the trail is not in the page's language (a zh-TW trail on
  // /en): marks the authored copy so assistive tech reads it as Chinese.
  const contentLang = contentLangFor(frontmatter.locale, safeLocale);
  // A failed list read degrades to no related links, never to raw slugs.
  const relatedTrails = resolveRelated(
    frontmatter.relatedTrails,
    trailList.ok ? trailList.trails : [],
  );
  const relatedStories = resolveRelated(
    frontmatter.relatedStories,
    storyList.ok ? storyList.stories : [],
  );
  // Falls back to the publication date: a trail that has never been revised is
  // current as of the day it shipped, and an empty updated row reads as an omission.
  const updatedLabel = formatStoryDate(
    frontmatter.updatedAt ?? frontmatter.publishedAt,
    safeLocale,
  );
  const heroSrc = editorialHeroSrc(heroImage);
  // ONE lede (DS2-23): the promise is the reader-facing sentence. The
  // description is the search snippet and stays in metadata; it shows here only
  // for a trail authored without a promise.
  const lede = frontmatter.promise ?? frontmatter.description;
  const metaItems: MetaItem[] = [
    ...(frontmatter.editorialOwner
      ? [
          {
            label: t("editorLabel"),
            value: frontmatter.editorialOwner,
            lang: contentLang,
          },
        ]
      : []),
    ...(updatedLabel
      ? [{ label: t("updatedLabel"), value: updatedLabel }]
      : []),
    ...(safeProducts.length > 0
      ? [
          {
            label: t("selectionLabel"),
            value: t("selectionSummary", { count: safeProducts.length }),
          },
        ]
      : []),
  ];
  const articleJsonLd = buildArticleJsonLd({
    title: frontmatter.title,
    description: frontmatter.description ?? "",
    path: routes.trail(frontmatter.slug),
    locale: safeLocale,
    author: frontmatter.editorialOwner ?? "Formoria",
    // The same image the hero renders, resolved by the same predicate: one the
    // page cannot display takes the imageless path and is not published here
    // either. Absolutised inside the builder.
    image: heroSrc,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [
      { label: t("breadcrumb"), href: routes.style() },
      { label: frontmatter.title },
    ],
    safeLocale,
  );

  return (
    <main className="pb-16 md:pb-24">
      <article>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(articleJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(breadcrumbJsonLd),
          }}
        />
        {safeProducts.length > 0 ? (
          <ViewItemListTracker
            listName={`trail:${slug}`}
            itemCount={safeProducts.length}
          />
        ) : null}
        {/*
          THE HEADER BAND. `surface` is the second material, not a tint: the band
          is what separates the editorial frame — who chose this, when, how much
          of it there is — from the objects below, and it does that with tone and
          a rule rather than with a box around the title.

          With a displayable hero the scene image opens the trail as a
          full-bleed band (DS2-35, DESIGN.md §6 scene layer): 3:4 below md,
          21:9 from md, the title and lede on an ink scrim over its foot — the
          scrim pattern of the /style hub's feature TrailTile, sized by the copy
          so every line sits on ink/80 or darker. No fixed min-height: the copy
          grows the band instead of clipping. Without one, the title and lede
          sit directly on the surface band.
        */}
        <header className="border-b border-rule bg-surface">
          <PageShell measure="page" className="space-y-6 pt-8">
            <Breadcrumb
              ariaLabel={t("breadcrumbAria")}
              items={[
                { label: t("breadcrumb"), href: routes.style() },
                { label: frontmatter.title },
              ]}
            />
            {/* UI copy in the page's language, so outside the `lang` wrapper. */}
            {contentLang ? (
              <p className="type-body-sm text-ink-muted">
                {t("untranslatedNotice")}
              </p>
            ) : null}
          </PageShell>
          {heroSrc ? (
            <div className="relative mt-6 flex aspect-[3/4] flex-col justify-end overflow-clip bg-ink md:aspect-[21/9]">
              {/*
                `priority` and `fetchPriority="high"`, never lazy: this is the
                route's LCP element, so deferring it defers the metric itself.
              */}
              <SurfaceImage
                src={heroSrc}
                alt={frontmatter.heroImageAlt ?? ""}
                fill
                priority
                fetchPriority="high"
                surface="hero"
                className="object-cover"
              />
              <div className="relative z-10 bg-gradient-to-t from-ink/90 to-ink/80">
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-ink/80 to-transparent md:h-24"
                />
                <PageShell measure="page" className="pt-1 pb-8 md:pb-12">
                  <div lang={contentLang} className="space-y-4">
                    <h1 className="type-page-title text-ground">
                      {frontmatter.title}
                    </h1>
                    {lede ? (
                      <p className="type-lede text-on-ink">{lede}</p>
                    ) : null}
                  </div>
                </PageShell>
              </div>
            </div>
          ) : (
            <PageShell measure="page" className="pt-6">
              <div lang={contentLang} className="space-y-4">
                <h1 className="type-page-title">{frontmatter.title}</h1>
                {lede ? <p className="type-lede">{lede}</p> : null}
              </div>
            </PageShell>
          )}
          <PageShell measure="page" className="pt-6 pb-8 md:pb-10">
            <MetaLine items={metaItems} />
          </PageShell>
        </header>
        <PageShell measure="page">
          <div className="pt-10">
            <TrailContent
              source={trail.content}
              trailSlug={slug}
              locale={safeLocale}
              products={safeProducts}
              labels={trailLabels(t)}
              sections={frontmatter.sections}
              lang={contentLang}
            />
          </div>
          {similarProducts.length >= 3 && (
            <SavedProductsProvider>
              <section
                aria-label={t("exploreMore")}
                className="mt-section"
              >
                <h2 className="type-card-title">{t("exploreMore")}</h2>
                {/*
                  Two-up on phones (DS2-15): `thirds` alone is one-up there and
                  stacked six full-width tiles. `grid-cols-2` replaces its base
                  column through `cn`; three-up from lg keeps six as 3+3.
                */}
                <Grid cols="thirds" as="ul" className="mt-6 grid-cols-2">
                  {similarProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      locale={safeLocale}
                      imageSizes={IMAGE_SURFACE_SIZES.tile}
                    />
                  ))}
                </Grid>
              </section>
            </SavedProductsProvider>
          )}
          {(relatedStories.length > 0 || relatedTrails.length > 0) && (
            <div className="mt-section space-y-8">
              {relatedStoryLinks(
                t("relatedStories"),
                relatedStories,
                safeLocale,
              )}
              {relatedTrailTiles(t("relatedTrails"), relatedTrails, {
                eyebrow: tLanding("trails.eyebrow"),
                // No arrow glyph in a translated label (DESIGN.md §8
                // actionLinkStyles); `landing.trails.cta` still carries one.
                cta: t("relatedTrailCta"),
              })}
            </div>
          )}
        </PageShell>
      </article>
    </main>
  );
}
