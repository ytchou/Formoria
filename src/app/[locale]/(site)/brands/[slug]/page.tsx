import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  getApprovedBrandBySlug,
  getRelatedBrands,
  getBrandCountByCategory,
  getAllBrandSlugs,
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
import type { Brand } from "@/lib/types";
import { BrandViewTracker } from "@/components/brands/brand-view-tracker";
import { BrandEngagementTracker } from "@/components/brands/brand-engagement-tracker";
import { BrandBreadcrumb } from "@/components/brands/brand-breadcrumb";
import { ImageCarousel } from "@/components/brands/image-carousel";
import { BrandHeader } from "@/components/brands/brand-header";
import { BrandActions } from "@/components/brands/brand-actions";
import { AdminBrandMenu } from "@/components/brands/admin-brand-menu";
import { ClaimBrandCta } from "@/components/brands/claim-brand-cta";
import { BrandAbout } from "@/components/brands/brand-about";
import { BrandFaqAccordion } from "@/components/brands/brand-faq-accordion";
import { BrandLinks } from "@/components/brands/brand-links";
import { BrandSectionNav } from "@/components/brands/brand-section-nav";
import { BrandChannelsSection } from "@/components/brands/brand-channels-section";
import { RelatedBrands } from "@/components/brands/related-brands";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import { getBrandVisitLink } from "@/lib/brands/link-fallback";
import { faqItemsToQuestions, getBrandFaq } from "@/lib/services/brand-faq";
import { getChannelsForBrand } from "@/lib/services/brand-channels";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { cn } from "@/lib/utils";
import { shouldShowBrandSectionNav } from "@/lib/brands/section-nav";
import { NotFoundError } from "@/lib/errors";
import { truncateForMeta } from "@/lib/text/truncate-for-meta";
import { getBrandIndexability } from "@/lib/seo/brand-indexability";
import { getBrandGalleryImages } from "@/lib/services/brand-images";

// Shared section rhythm: hairline rule above each section, and enough scroll offset to clear
// the sticky main nav (100px) plus the mobile section-nav strip (48px).
const brandSectionClassName =
  "scroll-mt-40 border-t border-border pt-8 first:border-t-0 first:pt-0 md:scroll-mt-28";

// Temporary kill switch: the locations & retail-channels section is hidden from
// the public brand page until its presentation is reworked. Flipping this to
// true restores the nav entry, the section, and its channel fetch in one go —
// nothing else is stubbed. The `boolean` annotation is deliberate: without it
// the literal `false` makes the enabled branches unreachable to TS.
// Kept in lockstep with the skipped `public locations and retail channels`
// describe block in e2e/tests/brand-detail.spec.ts.
const LOCATIONS_SECTION_ENABLED: boolean = false;

// 1h ISR: ownership/verified-state changes propagate within ~an hour; route still statically served between regenerations
export const revalidate = 3600;

export async function generateStaticParams() {
  try {
    const slugs = await getAllBrandSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch {
    return [];
  }
}

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

type BrandFaqTranslateFn = (
  key: string,
  params?: Record<string, unknown>,
) => string;

const loadApprovedBrand = cache(async (slug: string): Promise<Brand> => {
  try {
    return await getApprovedBrandBySlug(slug);
  } catch (error) {
    if (!(error instanceof NotFoundError) || error.cause) throw error;
  }
  notFound();
});

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
  const heroImageAlt =
    (safeLocale === "en"
      ? heroImageMetadata?.altEn
      : heroImageMetadata?.altZh
    )?.trim() || brand.name;
  const heroImageDimensions =
    heroImageMetadata?.width && heroImageMetadata.height
      ? { width: heroImageMetadata.width, height: heroImageMetadata.height }
      : {};
  const { canonical, languages } = buildAlternates(
    `/brands/${brand.slug}`,
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
  const brand = await loadApprovedBrand(slug);

  const displayBrand: Brand = brand;
  const [tBrandDetail, tCities] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: "brandDetail" }),
    getTranslations({ locale: safeLocale, namespace: "cities" }),
  ]);
  const tBrandFaq = ((key: string, params?: Record<string, unknown>) =>
    tBrandDetail(key, params as never)) as BrandFaqTranslateFn;
  const cityLabel = displayBrand.city ? tCities(displayBrand.city) : null;
  const [faqItems, channels] = await Promise.all([
    getBrandFaq(
      displayBrand.id,
      displayBrand,
      tBrandFaq,
      safeLocale,
      cityLabel,
    ),
    // Skip the round trip entirely while the section is hidden.
    LOCATIONS_SECTION_ENABLED
      ? getChannelsForBrand(displayBrand.id)
      : Promise.resolve({ confirmed: [], possible: [] }),
  ]);
  const faqJsonLd = buildFaqPageJsonLd(faqItemsToQuestions(faqItems), safeLocale);

  const galleryImages = getBrandGalleryImages(displayBrand);

  const productTypeSlug =
    (displayBrand as Brand & { product_type?: string | null }).product_type ??
    null;
  const productTypeCategory = PRODUCT_TYPE_CATEGORIES.find(
    (category) => category.slug === productTypeSlug,
  );
  const categoryTag = productTypeCategory
    ? {
        slug: productTypeCategory.slug,
        name: productTypeCategory.name,
        nameZh: productTypeCategory.nameZh,
      }
    : null;

  // Parallel fetch: related brands + category count by product_type slug.
  const [relatedBrands, categoryCount] = await Promise.all([
    categoryTag
      ? getRelatedBrands(categoryTag.slug, displayBrand.slug, 4)
      : Promise.resolve<Brand[]>([]),
    categoryTag
      ? getBrandCountByCategory(categoryTag.slug, displayBrand.slug)
      : Promise.resolve(0),
  ]);

  const visitLink = getBrandVisitLink(displayBrand);
  const description =
    safeLocale === "en"
      ? (displayBrand.descriptionEn ?? displayBrand.description)
      : displayBrand.description;
  const sections = [
    ...(description
      ? [{ id: "about", label: tBrandDetail("tabNav.about") }]
      : []),
    // Both link sections render unconditionally now — a channel with no known
    // URL shows as a dimmed chip rather than disappearing.
    { id: "social", label: tBrandDetail("tabNav.social") },
    { id: "purchase", label: tBrandDetail("tabNav.purchase") },
    ...(LOCATIONS_SECTION_ENABLED
      ? [{ id: "locations", label: tBrandDetail("tabNav.locations") }]
      : []),
    ...(faqItems.length > 0
      ? [{ id: "faq", label: tBrandDetail("tabNav.faq") }]
      : []),
  ];
  const hasSectionNav = shouldShowBrandSectionNav(sections.length);

  // Breadcrumb items for JSON-LD
  const directoryLabel = tBrandDetail("breadcrumb.directory");
  const categoryLabel = productTypeCategory
    ? safeLocale === "en"
      ? productTypeCategory.name
      : productTypeCategory.nameZh
    : getBrandCategoryLabel(displayBrand, safeLocale === "en" ? "en" : "zh-TW");
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: directoryLabel, href: "/brands" },
    ...(categoryTag
      ? [
          {
            label: categoryLabel || categoryTag.name,
            href: `/brands?category=${categoryTag.slug}`,
          },
        ]
      : []),
    { label: displayBrand.name },
  ];

  return (
    // The saved-brands and engagement providers wrap the whole page: the view
    // tracker needs saved state, and the gallery/FAQ/channel sections all report
    // engagement. Hoisting the saved provider here does not add a fetch — it was
    // already mounted on this page, only around the actions slot.
    <SavedBrandsProvider>
      <BrandEngagementTracker brandId={displayBrand.id} slug={slug}>
        <main className="page-gutter mx-auto max-w-screen-xl py-10">
          <BrandViewTracker brandId={displayBrand.id} brandSlug={slug} />
          {/* JSON-LD structured data */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLdStringify(
                buildBrandJsonLd(displayBrand, safeLocale),
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
              dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(faqJsonLd) }}
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
          <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
            <div className="w-full lg:w-1/2">
              <ImageCarousel
                images={galleryImages}
                alt={displayBrand.name}
                brandId={displayBrand.id}
                brandSlug={displayBrand.slug}
                category={productTypeSlug}
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
                    brandSlug={displayBrand.slug}
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
              {!displayBrand.isVerified && (
                <div className="mt-8">
                  <ClaimBrandCta
                    brandId={displayBrand.id}
                    brandSlug={displayBrand.slug}
                  />
                </div>
              )}
            </div>
          </div>

          <div
            className={cn(
              "mt-8 border-t border-border pt-8",
              hasSectionNav && "grid md:grid-cols-5 md:gap-16",
            )}
          >
            <BrandSectionNav sections={sections} />

            <div
              className={cn(
                "flex min-w-0 flex-col gap-8",
                hasSectionNav && "md:col-span-4",
              )}
            >
              {description && (
                <section id="about" className={brandSectionClassName}>
                  <BrandAbout brand={displayBrand} locale={safeLocale} />
                </section>
              )}

              <BrandLinks
                brand={displayBrand}
                sectionIds={{ social: "social", purchase: "purchase" }}
                sectionClassName={brandSectionClassName}
              />

              {LOCATIONS_SECTION_ENABLED && (
                <section id="locations" className={brandSectionClassName}>
                  <BrandChannelsSection
                    locale={safeLocale}
                    confirmed={channels.confirmed}
                    possible={channels.possible}
                    brandId={displayBrand.id}
                    brandSlug={displayBrand.slug}
                  />
                </section>
              )}

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
        </main>
      </BrandEngagementTracker>
    </SavedBrandsProvider>
  );
}
