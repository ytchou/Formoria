import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import * as Sentry from "@sentry/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  getPublicBrandDetailBySlug,
  getPublicBrandFaqContextById,
} from "@/lib/services/brands";
import { getRelatedBrandsByCentroid } from "@/lib/services/brand-embeddings";
import {
  buildBrandJsonLd,
  buildBreadcrumbJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import type { BreadcrumbItem } from "@/lib/json-ld";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import {
  toPublicBrandCard,
  type PublicBrandDetail,
} from "@/lib/brands/contracts";
import { BrandViewTracker } from "@/components/brands/brand-view-tracker";
import { BrandEngagementTracker } from "@/components/brands/brand-engagement-tracker";
import { BrandBreadcrumb } from "@/components/brands/brand-breadcrumb";
import { ImageCarousel } from "@/components/brands/image-carousel";
import {
  BrandHeader,
  BrandHeroFacts,
  hasBrandHeroFacts,
} from "@/components/brands/brand-header";
import { BrandActions } from "@/components/brands/brand-actions";
import { AdminBrandMenu } from "@/components/brands/admin-brand-menu";
import { BrandAbout } from "@/components/brands/brand-about";
import { splitLede } from "@/lib/brands/split-lede";
import { BrandFaqAccordion } from "@/components/brands/brand-faq-accordion";
import {
  BrandChannelCorrections,
  BrandOtherLinks,
  BrandPurchaseLinks,
  BrandSocialLinks,
} from "@/components/brands/brand-links";
import { BrandSectionNav } from "@/components/brands/brand-section-nav";
import { StockistsSection } from "@/components/brands/stockists-section";
import { BrandSelectedProducts } from "@/components/brands/brand-selected-products";
import { RelatedBrands } from "@/components/brands/related-brands";
import { EditorialAppearances } from "@/components/brands/editorial-appearances";
import { getBrandEditorialAppearances } from "@/lib/services/editorial-links";
import { PageShell } from "@/components/ui/page-shell";
import { Typography } from "@/components/ui/typography";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import { getBrandVisitLink } from "@/lib/brands/link-fallback";
import { getBrandFaq } from "@/lib/services/brand-faq";
import { getStockistsForBrand } from "@/lib/services/stockists";
import { getPublishedCuratedProductsForBrand } from "@/lib/services/curated-products";
import { L1_CATEGORIES, isVisibleCategory } from "@/lib/taxonomy/ontology";
import { cn } from "@/lib/utils";
import { shouldShowBrandSectionNav } from "@/lib/brands/section-nav";
import { NotFoundError } from "@/lib/errors";
import { truncateForMeta } from "@/lib/text/truncate-for-meta";
import { getBrandIndexability } from "@/lib/seo/brand-indexability";
import { getBrandGalleryImages } from "@/lib/services/brand-images";
import { routes } from "@/lib/routes";

// Scroll offset for every section-nav target: clears the sticky main nav (100px)
// plus the mobile section-nav strip (48px). From md up there is no strip.
const sectionScrollClassName = "scroll-mt-40 md:scroll-mt-28";
// Content sections (story, selected products, where-to-buy) are separated by
// the section rhythm.
const contentSectionClassName = cn(
  sectionScrollClassName,
  "mt-section first:mt-0",
);
// Utility sections (featured-in, FAQ, social, other links) keep the hairline
// rhythm, and their headings step down to the card-title size (BD-12).
const utilitySectionClassName = cn(
  sectionScrollClassName,
  "mt-stack border-t border-rule pt-stack",
);

// 1h ISR: ownership/verified-state changes propagate within ~an hour; paths
// omitted from generateStaticParams are rendered on demand and cached between
// regenerations after their first request.
export const revalidate = 3600;

// Empty params keep all brand details on-demand ISR; never query the full brand
// corpus during `next build` just to populate this list.
export function generateStaticParams() {
  return [];
}

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

type BrandFaqTranslateFn = (
  key: string,
  params?: Record<string, unknown>,
) => string;

const loadApprovedBrand = cache(
  async (slug: string): Promise<PublicBrandDetail> => {
    try {
      return await getPublicBrandDetailBySlug(slug);
    } catch (error) {
      if (!(error instanceof NotFoundError) || error.cause) {
        // Rethrown NotFoundErrors reach Sentry via onRequestError with only the
        // "Brand not found" message. The underlying Supabase failure lives on
        // `cause` — surface it on the current scope so the auto-captured event
        // carries it instead of just the generic not-found text.
        if (error instanceof NotFoundError && error.cause) {
          Sentry.setContext("brandLookup", { slug, cause: error.cause });
        }
        throw error;
      }
    }
    notFound();
  },
);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations({
    locale: safeLocale,
    namespace: "brandDetail",
  });

  const brand = await loadApprovedBrand(slug);
  const indexability = getBrandIndexability(brand);
  const availableLocales: Locale[] = [
    ...(indexability["zh-TW"] ? (["zh-TW"] as const) : []),
    ...(indexability.en ? (["en"] as const) : []),
  ];
  const heroImageUrl = safeImageSrc(brand.heroImageUrl);
  const heroImageMetadata = brand.heroImageMetadata;
  const heroImageAlt = brand.name;
  const heroImageDimensions =
    heroImageMetadata?.width && heroImageMetadata.height
      ? { width: heroImageMetadata.width, height: heroImageMetadata.height }
      : {};
  const { canonical, languages } = buildAlternates(
    routes.brand(brand.slug),
    safeLocale,
    availableLocales,
  );
  const ogLocale = safeLocale === "zh-TW" ? "zh_TW" : "en_US";
  const ogAlternateLocale = safeLocale === "zh-TW" ? "en_US" : "zh_TW";
  const rawDescription =
    safeLocale === "en"
      ? (brand.blurbEn ??
        brand.descriptionEn ??
        brand.blurb ??
        brand.description)
      : (brand.blurb ?? brand.description);
  const description = truncateForMeta(
    rawDescription || t("metadata.fallbackDescription", { name: brand.name }),
  );
  return {
    title: brand.name,
    description,
    alternates: { canonical, languages },
    robots: indexability[safeLocale]
      ? undefined
      : { index: false, follow: true },
    openGraph: {
      type: "website",
      title: brand.name,
      description,
      url: canonical,
      images: heroImageUrl
        ? [{ url: heroImageUrl, alt: heroImageAlt, ...heroImageDimensions }]
        : undefined,
      locale: ogLocale,
      alternateLocale: availableLocales.includes(
        safeLocale === "en" ? "zh-TW" : "en",
      )
        ? [ogAlternateLocale]
        : undefined,
    },
    twitter: {
      title: brand.name,
      description,
      images: heroImageUrl ?? undefined,
    },
  };
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const displayBrand = await loadApprovedBrand(slug);

  const [tBrandDetail, tCities] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: "brandDetail" }),
    getTranslations({ locale: safeLocale, namespace: "cities" }),
  ]);
  const tBrandFaq = ((key: string, params?: Record<string, unknown>) =>
    tBrandDetail(key, params as never)) as BrandFaqTranslateFn;
  const cityLabel = displayBrand.city ? tCities(displayBrand.city) : null;
  const faqContext = await getPublicBrandFaqContextById(displayBrand.id);
  const [faqItems, stockists, curatedProducts, editorialAppearances] =
    await Promise.all([
      getBrandFaq(
        displayBrand.id,
        faqContext,
        tBrandFaq,
        safeLocale,
        cityLabel,
      ),
      getStockistsForBrand(displayBrand.id),
      getPublishedCuratedProductsForBrand(displayBrand.id),
      getBrandEditorialAppearances(displayBrand.slug).catch(() => ({
        trails: [],
        stories: [],
      })),
    ]);
  const stockistCount = stockists.confirmed.length + stockists.possible.length;
  // Same builder generateMetadata uses for <link rel="canonical">, so the
  // structured data can never name a different URL than the page's own tag.
  const { canonical: canonicalUrl } = buildAlternates(
    routes.brand(displayBrand.slug),
    safeLocale,
  );
  const galleryImages = getBrandGalleryImages(displayBrand);

  const categorySlugSlug = displayBrand.categorySlug;
  const categorySlugCategory = L1_CATEGORIES.find(
    (category) => category.slug === categorySlugSlug,
  );
  const categoryTag =
    categorySlugCategory && isVisibleCategory(categorySlugCategory.slug)
      ? {
          slug: categorySlugCategory.slug,
          name: categorySlugCategory.name,
          nameZh: categorySlugCategory.nameZh,
        }
      : null;

  const relatedResult = categoryTag
    ? await getRelatedBrandsByCentroid(displayBrand.id, categoryTag.slug, displayBrand.slug, 4)
    : { brands: [], totalCount: 0 };
  const relatedBrands = relatedResult.brands.map(toPublicBrandCard);
  const categoryCount = relatedResult.totalCount;

  const visitLink = getBrandVisitLink(displayBrand);
  const description =
    safeLocale === "en"
      ? (displayBrand.descriptionEn ?? displayBrand.description)
      : displayBrand.description;
  const hasEditorialAppearances =
    editorialAppearances.trails.length > 0 ||
    editorialAppearances.stories.length > 0;
  // One short label per section (`tabNav.short.*`), in page order, so the
  // strip fits a phone without scrolling (BD2-10); the headings keep their
  // full wording. An entry exists only when its section renders.
  const sections = [
    ...(description
      ? [{ id: "about", label: tBrandDetail("tabNav.short.about") }]
      : []),
    ...(curatedProducts.length > 0
      ? [
          {
            id: "selected-products",
            label: tBrandDetail("tabNav.short.selectedProducts"),
          },
        ]
      : []),
    // Where-to-buy and social render unconditionally — an empty channel set
    // shows a muted 「還沒有…」 line rather than disappearing.
    { id: "where-to-buy", label: tBrandDetail("tabNav.short.whereToBuy") },
    ...(hasEditorialAppearances
      ? [
          {
            id: "featured-in",
            label: tBrandDetail("tabNav.short.featuredIn"),
          },
        ]
      : []),
    ...(faqItems.length > 0
      ? [{ id: "faq", label: tBrandDetail("tabNav.short.faq") }]
      : []),
    { id: "social", label: tBrandDetail("tabNav.short.social") },
  ];
  const hasSectionNav = shouldShowBrandSectionNav(sections.length);
  const heroFacts = {
    cityLabel,
    foundingYear: displayBrand.foundingYear,
    selectedCount: curatedProducts.length,
    stockistCount,
  };
  const hasHeroFacts = hasBrandHeroFacts(heroFacts);
  // The colophon carries city and founding year, so the metadata line drops them.
  const hasHeroColophon =
    Boolean(cityLabel) || displayBrand.foundingYear != null;

  // Breadcrumb items for JSON-LD
  const directoryLabel = tBrandDetail("breadcrumb.directory");
  const categoryLabel = categorySlugCategory
    ? safeLocale === "en"
      ? categorySlugCategory.name
      : categorySlugCategory.nameZh
    : getBrandCategoryLabel(displayBrand, safeLocale === "en" ? "en" : "zh-TW");
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: directoryLabel, href: routes.brands() },
    ...(categoryTag
      ? [
          {
            label: categoryLabel || categoryTag.name,
            href: routes.brands({ category: categoryTag.slug }),
          },
        ]
      : []),
    { label: displayBrand.name },
  ];

  return (
    // The saved-brands and engagement providers wrap the whole page: the view
    // tracker needs saved state, and the gallery and FAQ sections report
    // engagement (dwell and scroll depth come from the tracker itself). The
    // stockist section reports nothing since DEV-1513 removed the community
    // confirm button, which was its only emitter. Hoisting the saved provider
    // here does not add a fetch — it was already mounted on this page, only
    // around the actions slot.
    <SavedBrandsProvider>
      <BrandEngagementTracker brandId={displayBrand.id} slug={slug}>
        <PageShell as="main" measure="page" className="py-10">
          <BrandViewTracker brandId={displayBrand.id} brandSlug={slug} />
          {/* JSON-LD structured data */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLdStringify(
                buildBrandJsonLd(
                  {
                    ...displayBrand,
                    heroImageAlt: displayBrand.imageAlts[0]?.altZh ?? null,
                  },
                  safeLocale,
                  canonicalUrl,
                  [...stockists.confirmed, ...stockists.possible],
                ),
              ),
            }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLdStringify(
                buildBreadcrumbJsonLd(breadcrumbItems, safeLocale),
              ),
            }}
          />
          {/* Breadcrumb */}
          <BrandBreadcrumb
            locale={safeLocale}
            categorySlug={categoryTag?.slug ?? null}
            categoryLabel={categoryLabel || null}
            brandName={displayBrand.name}
          />

          {/* Hero. DOM order is info, gallery, facts, so focus order matches
              what is seen at every width (BD2-08): below lg the name,
              metadata line, lede and route to the brand lead the screen,
              then the gallery, then the facts. At lg the gallery spans both
              rows of the left 7 columns, and the right 5 carry the info on
              top and the facts beneath, so the column no longer ends half
              way down the gallery (BD2-04). */}
          <div className="grid gap-stack lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-gutter">
            <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-1">
              <BrandHeader
                brand={displayBrand}
                categoryLabel={categoryLabel || null}
                cityLabel={cityLabel}
                omitProvenance={hasHeroColophon}
                lede={
                  description
                    ? splitLede(description, safeLocale, {
                        fallbackLede:
                          safeLocale === "en" ? displayBrand.blurbEn : null,
                      }).lede
                    : null
                }
                adminSlot={
                  <AdminBrandMenu
                    brandId={displayBrand.id}
                    brandName={displayBrand.name}
                  />
                }
                actionsSlot={
                  <BrandActions
                    websiteUrl={visitLink?.href ?? null}
                    visitKind={visitLink?.kind}
                    brandSlug={displayBrand.slug}
                    brandId={displayBrand.id}
                    brandName={displayBrand.name}
                    brandImageUrl={displayBrand.heroImageUrl ?? undefined}
                    categoryLabel={categoryLabel || null}
                    categorySlug={displayBrand.categorySlug ?? null}
                    subcategories={displayBrand.subcategories}
                  />
                }
              />
            </div>

            <div className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1">
              <ImageCarousel
                images={galleryImages}
                alt={displayBrand.name}
                brandId={displayBrand.id}
                brandSlug={displayBrand.slug}
                category={categorySlugSlug}
                imageAlts={displayBrand.imageAlts}
              />
            </div>

            {hasHeroFacts && (
              <div
                className={cn(
                  "min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-2 lg:self-start",
                  // Without a colophon only the md+ jump rows remain; an empty
                  // cell would still add a grid gap.
                  !hasHeroColophon && "max-md:hidden",
                )}
              >
                <BrandHeroFacts {...heroFacts} />
              </div>
            )}
          </div>

          {/* The section nav is a sibling of the sections it indexes so its
              sticky strip stays pinned across all of them. Mobile only. When
              the brand has a route-out link, the mobile route-out bar is the
              page's one sticky bar, so the strip does not stick. */}
          <div className="mt-stack md:mt-section">
            <BrandSectionNav sections={sections} sticky={!visitLink} />

            {/* Below md the first heading would otherwise sit flush against
                the strip's bottom rule; from md up there is no strip. */}
            <div className={cn("min-w-0", hasSectionNav && "pt-6 md:pt-0")}>
              <BrandAbout brand={displayBrand} locale={safeLocale} />

              {curatedProducts.length > 0 && (
                <section
                  id="selected-products"
                  className={contentSectionClassName}
                >
                  <BrandSelectedProducts
                    locale={safeLocale}
                    brand={displayBrand}
                    products={curatedProducts}
                  />
                </section>
              )}

              {/* Online and physical channels as one section, official site
                  first (BrandPurchaseLinks' first slot is the website). */}
              <section
                id="where-to-buy"
                aria-labelledby="where-to-buy-heading"
                className={contentSectionClassName}
              >
                <Typography
                  as="h2"
                  id="where-to-buy-heading"
                  variant="sectionTitleLarge"
                >
                  {tBrandDetail("sections.whereToBuy")}
                </Typography>
                <div className="mt-stack flex flex-col gap-stack">
                  <BrandPurchaseLinks brand={displayBrand} />
                  {stockistCount > 0 && (
                    <StockistsSection
                      locale={safeLocale}
                      confirmed={stockists.confirmed}
                      possible={stockists.possible}
                      brandId={displayBrand.id}
                      brandSlug={displayBrand.slug}
                    />
                  )}
                  <BrandChannelCorrections brand={displayBrand} />
                </div>
              </section>

              {hasEditorialAppearances && (
                <div id="featured-in" className={utilitySectionClassName}>
                  <EditorialAppearances
                    locale={safeLocale}
                    trails={editorialAppearances.trails}
                    stories={editorialAppearances.stories}
                  />
                </div>
              )}

              {faqItems.length > 0 && (
                <section id="faq" className={utilitySectionClassName}>
                  <BrandFaqAccordion items={faqItems} />
                </section>
              )}

              <BrandSocialLinks
                brand={displayBrand}
                sectionIds={{ social: "social" }}
                sectionClassName={cn(
                  utilitySectionClassName,
                  "[&_h2]:type-card-title",
                )}
              />
              <BrandOtherLinks
                brand={displayBrand}
                sectionClassName={cn(
                  utilitySectionClassName,
                  "[&_h2]:type-card-title",
                )}
              />
            </div>
          </div>

          {/* Related brands */}
          {categoryTag && (
            <RelatedBrands
              locale={safeLocale}
              brands={relatedBrands}
              category={categoryTag.slug}
              categoryName={categoryLabel || categoryTag.name}
              categoryLabel={categoryLabel || null}
              count={categoryCount}
              currentBrandSlug={displayBrand.slug}
            />
          )}
        </PageShell>
      </BrandEngagementTracker>
    </SavedBrandsProvider>
  );
}
