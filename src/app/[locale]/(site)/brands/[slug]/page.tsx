import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import * as Sentry from "@sentry/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  getPublicBrandDetailBySlug,
  getPublicBrandFaqContextById,
  getRelatedBrands,
} from "@/lib/services/brands";
import {
  buildBrandJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
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
import { BrandHeader } from "@/components/brands/brand-header";
import { BrandActions } from "@/components/brands/brand-actions";
import { AdminBrandMenu } from "@/components/brands/admin-brand-menu";
import { BrandAbout } from "@/components/brands/brand-about";
import { BrandFaqAccordion } from "@/components/brands/brand-faq-accordion";
import { BrandLinks } from "@/components/brands/brand-links";
import { BrandSectionNav } from "@/components/brands/brand-section-nav";
import { StockistsSection } from "@/components/brands/stockists-section";
import { BrandSelectedProducts } from "@/components/brands/brand-selected-products";
import { RelatedBrands } from "@/components/brands/related-brands";
import { EditorialAppearances } from "@/components/brands/editorial-appearances";
import { getBrandEditorialAppearances } from "@/lib/services/editorial-links";
import { PageShell } from "@/components/ui/page-shell";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import { getBrandVisitLink } from "@/lib/brands/link-fallback";
import { faqItemsToQuestions, getBrandFaq } from "@/lib/services/brand-faq";
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

// Shared section rhythm: hairline rule above each section, and enough scroll offset to clear
// the sticky main nav (100px) plus the mobile section-nav strip (48px).
const brandSectionClassName =
  "scroll-mt-40 border-t border-rule pt-stack first:border-t-0 first:pt-0 md:scroll-mt-28";

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
  const faqJsonLd = buildFaqPageJsonLd(
    faqItemsToQuestions(faqItems),
    safeLocale,
    canonicalUrl,
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
    ? await getRelatedBrands(categoryTag.slug, displayBrand.slug, 4)
    : { brands: [], totalCount: 0 };
  const relatedBrands = relatedResult.brands.map(toPublicBrandCard);
  const categoryCount = relatedResult.totalCount;

  const visitLink = getBrandVisitLink(displayBrand);
  const description =
    safeLocale === "en"
      ? (displayBrand.descriptionEn ?? displayBrand.description)
      : displayBrand.description;
  const sections = [
    ...(curatedProducts.length > 0
      ? [
          {
            id: "selected-products",
            label: tBrandDetail("tabNav.selectedProducts"),
          },
        ]
      : []),
    // Both link sections render unconditionally now — a stockist with no known
    // URL shows as a dimmed chip rather than disappearing.
    { id: "social", label: tBrandDetail("tabNav.social") },
    { id: "purchase", label: tBrandDetail("tabNav.purchase") },
    ...(stockistCount > 0
      ? [{ id: "locations", label: tBrandDetail("tabNav.locations") }]
      : []),
    ...(faqItems.length > 0
      ? [{ id: "faq", label: tBrandDetail("tabNav.faq") }]
      : []),
  ];
  const hasSectionNav = shouldShowBrandSectionNav(sections.length);

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
          {faqJsonLd && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: safeJsonLdStringify(faqJsonLd),
              }}
            />
          )}
          {/* Breadcrumb */}
          <BrandBreadcrumb
            locale={safeLocale}
            categorySlug={categoryTag?.slug ?? null}
            categoryLabel={categoryLabel || null}
            brandName={displayBrand.name}
          />

          {/* Hero */}
          <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
            <div className="w-full lg:w-1/2">
              <ImageCarousel
                images={galleryImages}
                alt={displayBrand.name}
                brandId={displayBrand.id}
                brandSlug={displayBrand.slug}
                category={categorySlugSlug}
                imageAlts={displayBrand.imageAlts}
              />
            </div>

            <div className="min-w-0 lg:w-1/2">
              <BrandHeader
                brand={displayBrand}
                categoryLabel={categoryLabel || null}
                cityLabel={cityLabel}
                locale={safeLocale}
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
                  />
                }
              />
              {description ? (
                <div className="mt-8 pt-8">
                  <BrandAbout brand={displayBrand} locale={safeLocale} />
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              "mt-stack border-t border-rule pt-stack",
              hasSectionNav && "grid md:grid-cols-5 md:gap-16",
            )}
          >
            <BrandSectionNav sections={sections} />

            <div
              className={cn(
                "flex min-w-0 flex-col gap-8",
                // Mobile only: the nav is a full-width sticky strip directly
                // above this column, and the first section carries `first:pt-0`,
                // so its heading would otherwise sit flush against the strip's
                // bottom rule. On md+ the nav is a left rail beside this column,
                // not above it, and the offset would be dead space.
                hasSectionNav && "pt-6 md:col-span-4 md:pt-0",
              )}
            >
              {curatedProducts.length > 0 && (
                <section
                  id="selected-products"
                  className={brandSectionClassName}
                >
                  <BrandSelectedProducts
                    locale={safeLocale}
                    brand={displayBrand}
                    products={curatedProducts}
                  />
                </section>
              )}

              <BrandLinks
                brand={displayBrand}
                sectionIds={{ social: "social", purchase: "purchase" }}
                sectionClassName={brandSectionClassName}
              />

              {stockistCount > 0 && (
                <section id="locations" className={brandSectionClassName}>
                  <StockistsSection
                    locale={safeLocale}
                    confirmed={stockists.confirmed}
                    possible={stockists.possible}
                    brandId={displayBrand.id}
                    brandSlug={displayBrand.slug}
                  />
                </section>
              )}

              <EditorialAppearances
                locale={safeLocale}
                trails={editorialAppearances.trails}
                stories={editorialAppearances.stories}
                sectionClassName={brandSectionClassName}
              />

              {faqItems.length > 0 && (
                <section id="faq" className={brandSectionClassName}>
                  <BrandFaqAccordion
                    items={faqItems}
                    brandSlug={displayBrand.slug}
                  />
                </section>
              )}
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
