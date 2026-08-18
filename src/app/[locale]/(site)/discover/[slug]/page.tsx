import type { Metadata } from "next";
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
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { trailIndexBlockers, type TrailIndexBlocker } from "@/lib/seo/trail-indexability";
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
import { shouldHideUnderSuppliedTrail } from "@/lib/services/trail-supply";
import { TrailContent } from "./trail-content";

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
  blockers,
}: {
  locale: string;
  trail: TrailEntry;
  blockers: TrailIndexBlocker[];
}): Metadata {
  const safeLocale: Locale = locale === "en" ? "en" : "zh-TW";
  const path = `/discover/${trail.frontmatter.slug}`;
  const { canonical, languages } = buildAlternates(path, "zh-TW", ["zh-TW"]);

  return {
    title: trail.frontmatter.title,
    description: trail.frontmatter.description,
    alternates: { canonical, languages },
    ...(blockers.length > 0
      ? { robots: { index: false, follow: true } }
      : {}),
    openGraph: {
      title: trail.frontmatter.title,
      description: trail.frontmatter.description,
      url: canonical,
      type: "article",
      locale: safeLocale === "en" ? "en_US" : "zh_TW",
    },
  };
}

// Empty params keep every trail on ISR, rendered on first request and cached
// until `revalidate`. Same shape as `brands/[slug]`, for a second reason that
// matters more here: enumerating trails made this route read the database during
// `next build`, and a failed read there calls `markRenderDegraded`, which
// demotes the route to dynamic for the whole deployment. Production is missing
// the curated-product migrations (DEV-1482), so that read fails with 42703
// today and would cost `/discover/[slug]` its ISR cache entirely. Returning no
// params removes the build-time read, so the route cannot be demoted by one.
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
  const { trail, products } = await getTrailPageData(slug);

  if (!trail) notFound();

  return buildTrailMetadata({
    locale,
    trail: trail.entry,
    blockers: trailIndexBlockers({
      frontmatter: trail.entry.frontmatter,
      products: products ?? [],
    }),
  });
}

function trailLabels(t: (key: string) => string): SelectedProductTileLabels {
  return {
    cta: t("productCta"),
    brandSiteCta: t("brandSiteCta"),
    selectedBadge: t("selectedBadge"),
    unavailable: t("unavailable"),
  };
}

function relatedLinks(
  title: string,
  values: string[],
  hrefBase: string,
): React.ReactNode {
  if (values.length === 0) return null;
  return (
    <section aria-labelledby={`${hrefBase.slice(1)}-related`} className="space-y-3">
      <h2 id={`${hrefBase.slice(1)}-related`} className="type-section-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body">
        {values.map((value) => (
          <li key={value}>
            <a
              href={`${hrefBase}/${encodeURIComponent(value)}`}
              className="text-primary underline underline-offset-4 hover:text-primary-dark"
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
      <h2 id="stories-related" className="type-section-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body">
        {values.map((value, position) => (
          <li key={value}>
            <RelatedStoryLink
              href={`/stories/${encodeURIComponent(value)}`}
              storySlug={value}
              position={position}
              storySurface="trail_related_stories"
              className="text-primary underline underline-offset-4 hover:text-primary-dark"
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
      <h2 id="trails-related" className="type-section-title">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body">
        {values.map((value, position) => (
          <li key={value}>
            <RelatedTrailLink
              href={`/discover/${encodeURIComponent(value)}`}
              trailSlug={value}
              position={position}
              trailSurface="trail_related"
              className="text-primary underline underline-offset-4 hover:text-primary-dark"
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
  const { trail, products } = await getTrailPageData(slug);

  if (!trail) notFound();
  if (products === null) await markRenderDegraded("discover.trail.products");
  // Supply gate, deliberately BELOW `markRenderDegraded`. Above it the route is
  // still statically rendering, so a `notFound()` freezes a 404 into the whole
  // deployment; below it a failed read has already demoted this render to
  // dynamic. (The predicate's own null-read semantics are documented on it.)
  if (
    shouldHideUnderSuppliedTrail({
      frontmatter: trail.entry.frontmatter,
      products,
    })
  ) {
    notFound();
  }
  const safeProducts = products ?? [];

  const entry = trail.entry;
  const frontmatter = entry.frontmatter;
  const sections = frontmatter.sections.map((section) => ({
    id: section.key,
    label: section.title,
  }));
  const articleJsonLd = buildArticleJsonLd({
    title: frontmatter.title,
    description: frontmatter.description ?? "",
    path: `/discover/${frontmatter.slug}`,
    locale: safeLocale,
    author: frontmatter.editorialOwner ?? "Formoria",
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [{ label: t("breadcrumb"), href: "/discover" }, { label: frontmatter.title }],
    safeLocale,
  );

  return (
    <main className="page-gutter mx-auto box-border w-full max-w-[920px] pt-8 pb-16 md:pt-12 md:pb-24">
      <Breadcrumb
        ariaLabel={t("breadcrumbAria")}
        items={[{ label: t("breadcrumb"), href: "/discover" }, { label: frontmatter.title }]}
      />
      <article className="space-y-8">
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
        <header className="max-w-[720px] space-y-4">
          <h1 className="type-page-title-large">{frontmatter.title}</h1>
          {frontmatter.description ? (
            <p className="type-page-subtitle">{frontmatter.description}</p>
          ) : null}
          {frontmatter.promise ? (
            <p className="type-body-muted">{frontmatter.promise}</p>
          ) : null}
        </header>
        {sections.length >= 2 ? (
          <BrandSectionNav
            sections={sections}
            ariaLabel={t("sectionNavAria")}
            orientation="horizontal"
          />
        ) : null}
        <div className="max-w-[720px]">
          <TrailContent
            source={trail.content}
            trailSlug={slug}
            locale={safeLocale}
            products={safeProducts}
            labels={trailLabels(t)}
          />
        </div>
        {frontmatter.faq.length > 0 ? <FaqBlock questions={frontmatter.faq} /> : null}
        <div className="max-w-[720px] space-y-8">
          {relatedLinks(t("relatedCategories"), frontmatter.relatedCategories, "/categories")}
          {relatedStoryLinks(t("relatedStories"), frontmatter.relatedStories)}
          {relatedTrailLinks(t("relatedTrails"), frontmatter.relatedTrails)}
        </div>
      </article>
    </main>
  );
}
