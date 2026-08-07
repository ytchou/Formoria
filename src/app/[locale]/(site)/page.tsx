import type { Metadata } from "next";
import Image from "next/image";
import { NextIntlClientProvider } from "next-intl";
import {
  getTranslations,
  setRequestLocale,
  getMessages,
} from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import HeroSection from "@/components/landing/hero-section";
import BrandShowcase from "@/components/shared/brand-showcase";
import SectionBand from "@/components/landing/section-band";
import {
  EXPLORE_BRAND_LIMIT,
  getExploreBrands,
  getNewBrands,
} from "@/lib/services/brands";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { getAllStories } from "@/lib/services/stories";
import { StoryRow } from "@/components/stories/story-row";
import { toPublicBrandCard } from "@/lib/brands/contracts";

export const revalidate = 3600;

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("landing.metadata");
  const { canonical, languages } = buildAlternates("/", safeLocale);

  const ogLocale = safeLocale === "zh-TW" ? "zh_TW" : "en_US";
  const ogAlternateLocale = safeLocale === "zh-TW" ? "en_US" : "zh_TW";

  return {
    title: { absolute: t("title") },
    description: t("description"),
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title: t("title"),
      description: t("description"),
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
  };
}

export default async function LandingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("landing");
  const jsonLd = buildWebSiteJsonLd(safeLocale);
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale);

  const [exploreResult, newBrandsResult, storyResult, messages] =
    await Promise.all([
      getExploreBrands(EXPLORE_BRAND_LIMIT).catch(
        captureReadFailure("landing.exploreBrands"),
      ),
      getNewBrands(4).catch(captureReadFailure("landing.newBrands")),
      getAllStories(safeLocale),
      getMessages(),
    ]);

  // Aggregate flag: ANY failed read means this render is degraded, and a degraded
  // render must never be frozen by `revalidate = 3600`.
  const degraded = exploreResult === null || newBrandsResult === null;
  if (degraded) {
    await markRenderDegraded("landing");
  }

  const exploreBrands = (exploreResult?.brands ?? []).map(toPublicBrandCard);
  const newBrands = (newBrandsResult ?? []).map(toPublicBrandCard);
  // Suppressed per read, not per page: a failed `getNewBrands` must not hide a
  // total count that `getExploreBrands` returned successfully. `undefined` omits
  // the figure rather than asserting a false zero; a genuinely empty DB still
  // resolves `totalCount: 0` and renders 0.
  const totalBrandCount = exploreResult?.totalCount;
  const latestStories = storyResult.ok ? storyResult.stories.slice(0, 3) : [];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(organizationJsonLd),
        }}
      />
      <main>
        <HeroSection
          brandCount={totalBrandCount}
          categoryCount={PRODUCT_TYPE_CATEGORIES.length}
        />

        <SavedBrandsProvider>
          <div className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <NextIntlClientProvider messages={messages}>
                <BrandShowcase
                  brands={exploreBrands}
                  heading={t("showcase.heading")}
                  subheading={t("showcase.subheading")}
                  linkText={t("showcase.browseAll")}
                  linkHref="/brands"
                />
              </NextIntlClientProvider>
            </div>
          </div>

          {/* Manifesto pull-quote */}
          <section className="relative overflow-hidden py-12 md:py-16">
            <Image
              src="/images/manifesto-bg.webp"
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div
              className="absolute inset-0 bg-background/70"
              aria-hidden="true"
            />
            <div className="relative mx-auto max-w-4xl page-gutter text-center">
              <blockquote className="type-page-title-large text-foreground">
                {t("manifesto.headline")}
              </blockquote>
              <p className="mt-3 type-body-muted">{t("manifesto.body1")}</p>
              <p className="mt-3 type-body-muted">{t("manifesto.body2")}</p>
              <Link
                href="/about"
                className={buttonVariants({
                  variant: "primary",
                  tone: "cta",
                  className: "mt-4",
                })}
              >
                {t("manifesto.cta")}
              </Link>
            </div>
          </section>

          {latestStories.length > 0 && (
            <div className="py-6 md:py-8">
              <section className="mx-auto max-w-6xl page-gutter">
                <div className="mb-6">
                  <h2 className="type-section-title-large">
                    {t("latestStories.heading")}
                  </h2>
                </div>
                <div className="divide-y divide-border border-y border-border">
                  {latestStories.map((story) => (
                    <StoryRow
                      key={story.slug}
                      story={story}
                      locale={safeLocale}
                      headingLevel={3}
                    />
                  ))}
                </div>
                <div className="mt-6">
                  <Link href="/stories" className="font-medium text-primary">
                    {t("latestStories.linkText")}
                  </Link>
                </div>
              </section>
            </div>
          )}

          <div className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <BrandShowcase
                brands={newBrands}
                heading={t("newBrands.heading")}
                linkText={t("newBrands.linkText")}
                linkHref="/brands"
              />
            </div>
          </div>
        </SavedBrandsProvider>

        <SectionBand />
      </main>
    </>
  );
}
