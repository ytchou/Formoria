import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  buildArticleJsonLd,
  buildOrganizationJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { Link } from "@/i18n/navigation";
import AboutHero from "@/components/about/about-hero";
import TaiwanStats from "@/components/about/taiwan-stats";
import MissionPillars from "@/components/about/mission-pillars";
import { AboutCard } from "@/components/about/about-card-grid";
import { buttonVariants } from "@/components/ui/button";
import { getBrandStats, getRecentBrandCount } from "@/lib/services/brands";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";

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
  const t = await getTranslations("about.metadata");
  const title = t("title");
  const description = t("description");
  const { canonical, languages } = buildAlternates("/about", safeLocale);
  const ogLocale = safeLocale === "zh-TW" ? "zh_TW" : "en_US";
  const ogAlternateLocale = safeLocale === "zh-TW" ? "en_US" : "zh_TW";

  return {
    title,
    description,
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
      type: "article",
    }),
  };
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const [t, visionT, metadataT] = await Promise.all([
    getTranslations("about"),
    getTranslations("vision"),
    getTranslations("about.metadata"),
  ]);
  const title = metadataT("title");
  const description = metadataT("description");
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale);
  const articleJsonLd = buildArticleJsonLd({
    title,
    description,
    path: "/about",
    locale: safeLocale,
  });

  const [stats, recentBrands] = await Promise.all([
    getBrandStats().catch(captureReadFailure("about.brandStats")),
    getRecentBrandCount().catch(captureReadFailure("about.recentBrandCount")),
  ]);

  // Aggregate flag: ANY failed read means this render is degraded, and a degraded
  // render must never be frozen by `revalidate = 3600`.
  const degraded = stats === null || recentBrands === null;
  if (degraded) {
    await markRenderDegraded("about");
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(organizationJsonLd),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(articleJsonLd) }}
      />
      <main>
        {/* Each figure is suppressed by ITS OWN read: a failed `getRecentBrandCount`
            must not hide stats that `getBrandStats` returned. `undefined` omits the
            figure; a genuinely empty DB still resolves 0 and renders 0. */}
        <AboutHero
          brandCount={stats?.brandCount}
          categoryCount={stats?.categoryCount}
          recentBrands={recentBrands ?? undefined}
        />

        <MissionPillars
          heading={t("mission.heading")}
          statement={t("mission.statement")}
          context={t("mission.context")}
          pillars={[
            {
              heading: t("mission.promote.heading"),
              body: t("mission.promote.body"),
            },
            {
              heading: t("mission.smallBusiness.heading"),
              body: t("mission.smallBusiness.body"),
            },
            {
              heading: t("mission.platform.heading"),
              body: t("mission.platform.body"),
            },
          ]}
        />

        <section
          id="vision"
          className="scroll-mt-32 bg-secondary py-12 md:py-20"
        >
          <div className="page-gutter mx-auto max-w-6xl">
            <h2 className="type-page-title-large text-balance">
              {visionT("future.sectionHeading")}
            </h2>
            <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] md:items-start">
              <div>
                <h3 className="type-section-title-large text-balance">
                  {visionT("future.heading")}
                </h3>
                <p className="mt-5 type-page-subtitle text-pretty">
                  {visionT("future.body")}
                </p>
              </div>
              <AboutCard>
                <h3 className="type-card-title">
                  {visionT("future.principleHeading")}
                </h3>
                <p className="mt-3 type-page-subtitle text-pretty">
                  {visionT("future.principleBody")}
                </p>
              </AboutCard>
            </div>
          </div>
        </section>

        <TaiwanStats
          heading={t("taiwanStats.heading")}
          intro={t("taiwanStats.intro")}
          items={[
            {
              value: t("taiwanStats.items.count.value"),
              label: t("taiwanStats.items.count.label"),
            },
            {
              value: t("taiwanStats.items.share.value"),
              label: t("taiwanStats.items.share.label"),
            },
            {
              value: t("taiwanStats.items.employment.value"),
              label: t("taiwanStats.items.employment.label"),
            },
          ]}
          sourceLabel={t("taiwanStats.sourceLabel")}
          sourceName={t("taiwanStats.sourceName")}
        />

        <section className="relative overflow-hidden py-12 md:py-16">
          <Image
            src="/images/hero-bg.png"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-right"
          />
          <div
            className="absolute inset-0 bg-background/75"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl page-gutter">
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="type-page-title-large text-balance">
                  {t("guide.heading")}
                </h2>
              </div>
              <div>
                <Link
                  href="/getting-started"
                  className={buttonVariants({
                    variant: "primary",
                    tone: "cta",
                    size: "large",
                    className: "min-h-12",
                  })}
                >
                  {t("guide.cta")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
