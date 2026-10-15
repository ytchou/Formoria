import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import * as Sentry from "@sentry/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  getCachedPublicBrandDetailBySlug,
  getCachedPublicBrandFacts,
} from "@/lib/services/public-brand-render-data";
import {
  buildBrandJsonLd,
  buildBreadcrumbJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
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
import { BrandSection } from "@/components/brands/brand-section";
import { BrandFaqAccordion } from "@/components/brands/brand-faq-accordion";
import {
  BrandChannelCorrections,
  BrandOtherLinks,
  BrandPurchaseLinks,
  BrandSocialChannels,
} from "@/components/brands/brand-links";
import { BrandSectionNav } from "@/components/brands/brand-section-nav";
import { StockistsSection } from "@/components/brands/stockists-section";
import { BrandSelectedProducts } from "@/components/brands/brand-selected-products";
import { RelatedBrands } from "@/components/brands/related-brands";
import { EditorialAppearances } from "@/components/brands/editorial-appearances";
import {
  getBrandEditorialAppearances,
  getBrandProductTrailLinks,
} from "@/lib/services/editorial-links";
import {
  brandCategoryTag,
  buildBrandDetailView,
} from "@/lib/services/brand-detail-view";
import { PageShell } from "@/components/ui/page-shell";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { renderBrandFaq } from "@/lib/services/brand-faq";
import { getPublishedCuratedProductsForBrand } from "@/lib/services/curated-products";
import { cn } from "@/lib/utils";
import { shouldShowBrandSectionNav } from "@/lib/brands/section-nav";
import { NotFoundError } from "@/lib/errors";
import { truncateForMeta } from "@/lib/text/truncate-for-meta";
import { getBrandIndexability } from "@/lib/seo/brand-indexability";
import { getBrandGalleryImages } from "@/lib/services/brand-images";
import { routes } from "@/lib/routes";
import { captureReadFailure } from "@/lib/degraded-render";

// Optional editorial failures must recover on the next request, including cold loads.
export const revalidate = 0;

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
      return await getCachedPublicBrandDetailBySlug(slug);
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
  // Needed before the facts read: related brands are keyed by public category.
  const categoryTag = brandCategoryTag(displayBrand.categorySlug);

  // One hop after the brand: every read below depends only on it.
  const [
    tBrandDetail,
    tCities,
    facts,
    curatedProducts,
    editorialAppearances,
    productGuides,
  ] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: "brandDetail" }),
    getTranslations({ locale: safeLocale, namespace: "cities" }),
    getCachedPublicBrandFacts(
      displayBrand.id,
      categoryTag?.slug ?? null,
      displayBrand.slug,
    ),
    getPublishedCuratedProductsForBrand(displayBrand.id),
    getBrandEditorialAppearances(displayBrand.slug).catch((error) => {
      captureReadFailure("brand.editorialAppearances")(error);
      return { trails: [], stories: [] };
    }),
    // The guide links are an enhancement: a failed read shows the tiles
    // without them (and so without a 選物 label), never an error.
    getBrandProductTrailLinks(displayBrand.slug).catch((error) => {
      captureReadFailure("brand.productTrailLinks")(error);
      return {};
    }),
  ]);
  const tBrandFaq = ((key: string, params?: Record<string, unknown>) =>
    tBrandDetail(key, params as never)) as BrandFaqTranslateFn;
  const cityLabel = displayBrand.city ? tCities(displayBrand.city) : null;
  const { stockists, relatedBrands, relatedPreviews, categoryCount } = facts;
  const faqItems = renderBrandFaq(
    facts.faqEntries,
    facts.faqContext,
    tBrandFaq,
    safeLocale,
    cityLabel,
    curatedProducts.flatMap((p) => (p.subcategory ? [p.subcategory] : [])),
  );
  const hasEditorialAppearances =
    editorialAppearances.trails.length > 0 ||
    editorialAppearances.stories.length > 0;
  const view = buildBrandDetailView({
    brand: displayBrand,
    locale: safeLocale,
    cityLabel,
    directoryLabel: tBrandDetail("breadcrumb.directory"),
    curatedCount: curatedProducts.length,
    curatedSubcategories: curatedProducts.map((product) => product.subcategory),
    stockists,
    hasEditorialAppearances,
    faqItemCount: faqItems.length,
  });
  const { categoryLabel, visitLink, heroFacts, hasHeroColophon } = view;
  const sections = view.sections.map(({ id, labelKey }) => ({
    id,
    label: tBrandDetail(labelKey),
  }));
  const hasSectionNav = shouldShowBrandSectionNav(sections.length);
  const hasHeroFacts = hasBrandHeroFacts(heroFacts);
  const galleryImages = getBrandGalleryImages(displayBrand);

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
                  view.canonical,
                  [...stockists.confirmed, ...stockists.possible],
                ),
              ),
            }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLdStringify(
                buildBreadcrumbJsonLd(view.breadcrumb, safeLocale),
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
                lede={view.lede}
                makesLabels={view.makesLabels}
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
                category={displayBrand.categorySlug}
                imageAlts={displayBrand.imageAlts}
              />
            </div>

            {hasHeroFacts && (
              <div
                className={cn(
                  "min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-2 lg:self-start",
                  // Without a colophon only the md+ route rows remain; an
                  // empty cell would still add a grid gap.
                  !hasHeroColophon && "max-md:hidden",
                )}
              >
                <BrandHeroFacts
                  {...heroFacts}
                  trackedBrand={view.links.tracked}
                />
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
                the strip's bottom rule; from md up there is no strip. Every
                section below is one BrandSection (BD-17), in the order of
                `view.sections`: product-led (BD-01), so the shelf comes
                first, then the route out and the story in one band. */}
            <div className={cn("min-w-0", hasSectionNav && "pt-6 md:pt-0")}>
              {curatedProducts.length > 0 && (
                // No shell heading: the shelf sets its own h2 beside the
                // carousel arrows.
                <BrandSection
                  id="selected-products"
                  rhythm="content"
                  data-brand-selected-products
                >
                  <BrandSelectedProducts
                    locale={safeLocale}
                    brand={view.links.visit}
                    products={curatedProducts}
                    guides={productGuides}
                  />
                </BrandSection>
              )}

              {/* One surface band: where-to-buy in the left 7 columns at lg,
                  the story in the right 5; below lg they stack in that order.
                  Without a story, where-to-buy takes the whole band. */}
              <div
                className="mt-section rounded-surface bg-surface p-6 first:mt-0 md:p-10"
                data-brand-band
              >
                <div className="grid gap-y-10 lg:grid-cols-12 lg:gap-x-gutter">
                  {/* Online, social and physical channels as one section,
                      official site first (the first purchase slot is the
                      website). Social sits before the stockists so a long
                      list never buries it. */}
                  <BrandSection
                    id="where-to-buy"
                    rhythm="band"
                    heading={tBrandDetail("sections.whereToBuy")}
                    className={cn(
                      "min-w-0",
                      view.storyParagraphs ? "lg:col-span-7" : "lg:col-span-12",
                    )}
                  >
                    <div className="mt-stack flex flex-col gap-stack">
                      <BrandPurchaseLinks
                        brand={view.links.tracked}
                        slots={view.links.channels.purchase}
                      />
                      <BrandSocialChannels
                        brand={view.links.tracked}
                        slots={view.links.channels.social}
                      />
                      {view.stockistCount > 0 && (
                        <StockistsSection
                          locale={safeLocale}
                          confirmed={stockists.confirmed}
                          possible={stockists.possible}
                          brandId={displayBrand.id}
                          brandSlug={displayBrand.slug}
                        />
                      )}
                      <BrandChannelCorrections brand={view.links.corrections} />
                    </div>
                  </BrandSection>

                  {view.storyParagraphs && (
                    // One column (BD-05). The bare `prose-measure` caps the
                    // stacked story below lg; in the 5-column band it is
                    // narrower than the cap anyway.
                    <BrandSection
                      id="about"
                      rhythm="band"
                      heading={tBrandDetail("sections.about")}
                      className="prose-measure min-w-0 lg:col-span-5"
                    >
                      <BrandAbout paragraphs={view.storyParagraphs} />
                    </BrandSection>
                  )}
                </div>
              </div>

              {hasEditorialAppearances && (
                <BrandSection
                  id="featured-in"
                  rhythm="utility"
                  heading={tBrandDetail("editorialAppearances.heading")}
                >
                  <EditorialAppearances
                    locale={safeLocale}
                    trails={editorialAppearances.trails}
                    stories={editorialAppearances.stories}
                  />
                </BrandSection>
              )}

              {faqItems.length > 0 && (
                <BrandSection
                  id="faq"
                  rhythm="utility"
                  heading={tBrandDetail("sections.faq")}
                >
                  <BrandFaqAccordion items={faqItems} />
                </BrandSection>
              )}

              {view.links.other.length > 0 && (
                <BrandSection
                  rhythm="utility"
                  heading={tBrandDetail("links.otherLinks")}
                >
                  <BrandOtherLinks
                    brand={view.links.tracked}
                    links={view.links.other}
                  />
                </BrandSection>
              )}
            </div>
          </div>

          {/* Related brands */}
          {categoryTag && (
            <RelatedBrands
              locale={safeLocale}
              brands={relatedBrands}
              previews={relatedPreviews}
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
