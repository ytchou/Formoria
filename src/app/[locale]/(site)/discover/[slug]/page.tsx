import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/brands/brand-breadcrumb";
import { BrandSectionNav } from "@/components/brands/brand-section-nav";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import { FaqBlock } from "@/components/stories/faq-block";
import {
  RelatedStoryLink,
  RelatedTrailLink,
} from "@/components/stories/related-story-link";
import { formatStoryDate } from "@/components/stories/story-date";
import { surfaceCardStyles } from "@/components/ui/card";
import {
  EditorialHero,
  editorialHeroSrc,
} from "@/components/ui/editorial-hero";
import { PageShell } from "@/components/ui/page-shell";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import {
  getPublishedTrailBySlug,
  type TrailEntry,
  type TrailDetailResult,
} from "@/lib/services/trails";
import { getPublishedCuratedProductsForTrail, type TrailCuratedProduct } from "@/lib/services/curated-products";
import { cn } from "@/lib/utils";
import { TrailContent } from "./trail-content";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";
import { getTrailRelatedContent } from "@/lib/services/editorial-links";

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const revalidate = 3600;

const getTrailPageData = cache(
  async (slug: string): Promise<{
    trail: TrailDetailResult | null;
    products: TrailCuratedProduct[] | null;
  }> => {
    const [trail, products] = await Promise.all([
      getPublishedTrailBySlug(slug),
      getPublishedCuratedProductsForTrail(slug).catch(
        captureReadFailure("discover.trail.products"),
      ),
    ]);
    return { trail, products };
  },
);

export function buildTrailMetadata({
  locale,
  trail,
  productsReadFailed = false,
}: {
  locale: string;
  trail: TrailEntry;
  /** `products === null` from `getTrailPageData` — the read threw, see below. */
  productsReadFailed?: boolean;
}): Metadata {
  const safeLocale: Locale = locale === "en" ? "en" : "zh-TW";
  const path = routes.trail(trail.frontmatter.slug);
  const { canonical, languages } = buildAlternates(path, "zh-TW", ["zh-TW"]);

  return {
    title: trail.frontmatter.title,
    description: trail.frontmatter.description,
    alternates: { canonical, languages },
    openGraph: {
      title: trail.frontmatter.title,
      description: trail.frontmatter.description,
      url: canonical,
      type: "article",
      locale: safeLocale === "en" ? "en_US" : "zh_TW",
    },
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
// demotes the route to dynamic for the whole deployment. Production's curated
// tables exist, but without `visible`, `category` and `subcategories`, so the
// read fails with Postgres 42703 today and would cost `/discover/[slug]` its
// ISR cache entirely. Returning no params removes the build-time read, so the
// route cannot be demoted by one.
//
// This was invisible until the first trail was published: while every trail was
// `draft: true` the list was empty anyway.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  // Already in hand and request-cached, so reading `products` here costs no extra
  // round trip: `getTrailPageData` is the same `cache`d call the page body makes.
  const { trail, products } = await getTrailPageData(slug);

  if (!trail) notFound();

  return buildTrailMetadata({
    locale,
    trail: trail.entry,
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
  };
}

/**
 * One line of the header band's meta table: an interface-face label, an
 * interface-face value, a hairline between rows. It is a `<dl>`, not a list of
 * paragraphs, because every row is a name/value pair and a screen reader should
 * be able to say so.
 */
function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt className="type-metadata">{label}</dt>
      <dd className="min-w-0 text-right type-metadata text-ink">{value}</dd>
    </div>
  );
}

function relatedLinks(
  title: string,
  values: string[],
  hrefBase: string,
): React.ReactNode {
  if (values.length === 0) return null;
  return (
    <section aria-labelledby={`${hrefBase.slice(1)}-related`} className="space-y-3">
      <h2 id={`${hrefBase.slice(1)}-related`} className="type-card-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
        {values.map((value) => (
          <li key={value}>
            <a
              href={`${hrefBase}/${encodeURIComponent(value)}`}
              className="text-accent underline underline-offset-4 hover:text-ink"
            >
              {value}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function relatedStoryLinks(
  title: string,
  values: string[],
): React.ReactNode {
  if (values.length === 0) return null;
  return (
    <section aria-labelledby="stories-related" className="space-y-3">
      <h2 id="stories-related" className="type-card-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
        {values.map((value, position) => (
          <li key={value}>
            <RelatedStoryLink
              href={routes.story(value)}
              storySlug={value}
              position={position}
              storySurface="trail_related_stories"
              className="text-accent underline underline-offset-4 hover:text-ink"
            >
              {value}
            </RelatedStoryLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function relatedTrailLinks(title: string, values: string[]): React.ReactNode {
  if (values.length === 0) return null;
  return (
    <section aria-labelledby="trails-related" className="space-y-3">
      <h2 id="trails-related" className="type-card-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
        {values.map((value, position) => (
          <li key={value}>
            <RelatedTrailLink
              href={routes.trail(value)}
              trailSlug={value}
              position={position}
              trailSurface="trail_related"
              className="text-accent underline underline-offset-4 hover:text-ink"
            >
              {value}
            </RelatedTrailLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function DiscoverTrailPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({ locale, namespace: "discover" });
  const [{ trail, products }, derivedContent] = await Promise.all([
    getTrailPageData(slug),
    getTrailRelatedContent(slug),
  ]);

  if (!trail) notFound();
  if (products === null) await markRenderDegraded("discover.trail.products");
  const safeProducts = products ?? [];

  const entry = trail.entry;
  const frontmatter = entry.frontmatter;
  const sections = frontmatter.sections.map((section) => ({
    id: section.key,
    label: section.title,
  }));
  const heroImage = frontmatter.heroImage;
  // Falls back to the publication date: a trail that has never been revised is
  // current as of the day it shipped, and an empty updated row reads as an omission.
  const updatedLabel = formatStoryDate(
    frontmatter.updatedAt ?? frontmatter.publishedAt,
    safeLocale,
  );
  // What the selection actually IS, counted rather than claimed. `category` is
  // the product's L1, so this is "how many kinds of thing", not how many tags.
  const categoryCount = new Set(
    safeProducts.map((product) => product.category),
  ).size;
  const articleJsonLd = buildArticleJsonLd({
    title: frontmatter.title,
    description: frontmatter.description ?? "",
    path: routes.trail(frontmatter.slug),
    locale: safeLocale,
    author: frontmatter.editorialOwner ?? "Formoria",
    // The same image the hero renders, resolved by the same predicate: one the
    // page cannot display takes the imageless path and is not published here
    // either. Absolutised inside the builder.
    image: editorialHeroSrc(heroImage),
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [{ label: t("breadcrumb"), href: routes.discover() }, { label: frontmatter.title }],
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
          <ViewItemListTracker listName={`trail:${slug}`} itemCount={safeProducts.length} />
        ) : null}
        {/*
          THE HEADER BAND. `surface` is the second material, not a tint: the band
          is what separates the editorial frame — who chose this, when, how much
          of it there is — from the objects below, and it does that with tone and
          a rule rather than with a box around the title.
        */}
        <header className="border-b border-rule bg-surface">
          <PageShell measure="page" className="pt-8 pb-10 md:pt-12 md:pb-14">
            <Breadcrumb
              ariaLabel={t("breadcrumbAria")}
              items={[
                { label: t("breadcrumb"), href: routes.discover() },
                { label: frontmatter.title },
              ]}
            />
            {/*
              The page hero, above the `<h1>`, exactly as a feature opens in
              print — literally the same component story detail opens with, so
              the two cannot drift again. The trail's copy had already drifted:
              its placeholder was `bg-surface`, the colour of THIS band, so the
              empty state was invisible against its own parent.
            */}
            <EditorialHero
              src={heroImage}
              alt={frontmatter.heroImageAlt ?? ""}
              className="mb-10"
            />
            <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)] md:gap-16">
              <div className="prose-measure space-y-4">
                <h1 className="type-page-title">{frontmatter.title}</h1>
                {frontmatter.description ? (
                  <p className="type-body">{frontmatter.description}</p>
                ) : null}
                {frontmatter.promise ? (
                  <p className="type-body-sm">{frontmatter.promise}</p>
                ) : null}
              </div>
              <dl className="divide-y divide-rule border-y border-rule md:self-start">
                {frontmatter.editorialOwner ? (
                  <MetaRow
                    label={t("editorLabel")}
                    value={frontmatter.editorialOwner}
                  />
                ) : null}
                {updatedLabel ? (
                  <MetaRow label={t("updatedLabel")} value={updatedLabel} />
                ) : null}
                {safeProducts.length > 0 ? (
                  <MetaRow
                    label={t("selectionLabel")}
                    value={t("selectionSummary", {
                      count: safeProducts.length,
                      categories: categoryCount,
                    })}
                  />
                ) : null}
              </dl>
            </div>
          </PageShell>
        </header>
        <PageShell measure="page">
          {sections.length >= 2 ? (
            <BrandSectionNav
              sections={sections}
              ariaLabel={t("sectionNavAria")}
              orientation="horizontal"
            />
          ) : null}
          <div className="pt-10">
            <TrailContent
              source={trail.content}
              trailSlug={slug}
              locale={safeLocale}
              products={safeProducts}
              labels={trailLabels(t)}
              sections={frontmatter.sections}
            />
          </div>
          {frontmatter.faq.length > 0 ? (
            <div className="mt-section prose-measure">
              <FaqBlock questions={frontmatter.faq} />
            </div>
          ) : null}
          {/*
            THE CLOSING ZONE. What was deliberately left out sits beside where to
            go next, because both answer the same reader question — "is this all
            of it?" — and neither is a footnote. `exclusions` is authored
            frontmatter that had no surface at all before this.
          */}
          <div className="mt-section grid gap-10 md:grid-cols-2 md:gap-16">
            {frontmatter.exclusions ? (
              <section
                aria-labelledby="trail-exclusions"
                className={cn(
                  surfaceCardStyles({ padding: "lg" }),
                  "h-full bg-surface",
                )}
              >
                <h2 id="trail-exclusions" className="type-card-title">
                  {t("exclusionsHeading")}
                </h2>
                <p className="mt-3 type-body-sm">
                  {frontmatter.exclusions}
                </p>
              </section>
            ) : null}
            <div className="space-y-8">
              {relatedLinks(
                t("relatedCategories"),
                frontmatter.relatedCategories,
                routes.categories(),
              )}
              {relatedStoryLinks(t("relatedStories"), frontmatter.relatedStories)}
              {relatedTrailLinks(t("relatedTrails"), frontmatter.relatedTrails)}
            </div>
          </div>
          {(derivedContent.categories.length > 0 ||
            derivedContent.stories.length > 0) && (
            <div className="mt-section space-y-8">
              {derivedContent.categories.length > 0 && (
                <nav aria-label={t("derivedCategoriesAriaLabel")}>
                  <h2 className="type-card-title">
                    {t("derivedCategories")}
                  </h2>
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
                    {derivedContent.categories.map((cat) => (
                      <li key={cat.slug}>
                        <Link
                          href={routes.category(cat.slug)}
                          className="text-accent underline underline-offset-4 hover:text-ink"
                        >
                          {safeLocale === "en" ? cat.name : cat.nameZh}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
              {derivedContent.stories.length > 0 && (
                <nav aria-label={t("derivedStoriesAriaLabel")}>
                  <h2 className="type-card-title">
                    {t("derivedStories")}
                  </h2>
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
                    {derivedContent.stories.map((story, idx) => (
                      <li key={story.slug}>
                        <RelatedStoryLink
                          href={routes.story(story.slug)}
                          storySlug={story.slug}
                          position={idx}
                          storySurface="trail_derived_stories"
                          className="text-accent underline underline-offset-4 hover:text-ink"
                        >
                          {story.title}
                        </RelatedStoryLink>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>
          )}
        </PageShell>
      </article>
    </main>
  );
}
