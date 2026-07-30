import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import MissionPillars from "@/components/about/mission-pillars";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  buildArticleJsonLd,
  buildOrganizationJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";

export const revalidate = 86400;

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("vision.metadata");
  const title = t("title");
  const description = t("description");
  const { canonical, languages } = buildAlternates("/vision", safeLocale);
  const ogLocale = safeLocale === "en" ? "en_US" : "zh_TW";
  const ogAlternateLocale = safeLocale === "en" ? "zh_TW" : "en_US";

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function VisionPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("vision");
  const title = t("metadata.title");
  const description = t("metadata.description");
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale);
  const articleJsonLd = buildArticleJsonLd({
    title,
    description,
    path: "/vision",
    locale: safeLocale,
  });

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
        <section className="border-b border-border py-14 md:py-24">
          <div className="page-gutter mx-auto max-w-6xl">
            <p className="type-eyebrow">{t("hero.eyebrow")}</p>
            <h1 className="mt-4 max-w-4xl type-hero text-balance">
              {t("hero.title")}
            </h1>
            <p className="mt-6 max-w-3xl type-page-subtitle text-pretty">
              {t("hero.intro")}
            </p>
          </div>
        </section>

        <section className="py-12 md:py-16">
          <div className="page-gutter mx-auto max-w-6xl">
            <div
              className={surfaceCardStyles({
                tone: "background",
                padding: "lg",
                className:
                  "grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10",
              })}
            >
              <p className="type-eyebrow text-primary">{t("today.eyebrow")}</p>
              <div>
                <h2 className="type-section-title-large text-balance">
                  {t("today.heading")}
                </h2>
                <p className="mt-3 type-body-muted text-pretty">
                  {t("today.body")}
                </p>
              </div>
            </div>
          </div>
        </section>

        <MissionPillars
          variant="sequence"
          heading={t("path.heading")}
          statement={t("path.statement")}
          pillars={[
            {
              heading: t("path.discover.heading"),
              body: t("path.discover.body"),
            },
            { heading: t("path.choose.heading"), body: t("path.choose.body") },
            { heading: t("path.grow.heading"), body: t("path.grow.body") },
          ]}
        />

        <section className="border-y border-border bg-card py-12 md:py-20">
          <div className="page-gutter mx-auto grid max-w-6xl gap-10 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] md:items-start">
            <div>
              <p className="type-eyebrow">{t("future.eyebrow")}</p>
              <h2 className="mt-4 type-page-title-large text-balance">
                {t("future.heading")}
              </h2>
              <p className="mt-5 type-page-subtitle text-pretty">
                {t("future.body")}
              </p>
            </div>
            <div className="border-l border-primary pl-6 md:mt-8">
              <h3 className="type-card-title text-cta">
                {t("future.principleHeading")}
              </h3>
              <p className="mt-3 type-body-muted text-pretty">
                {t("future.principleBody")}
              </p>
            </div>
          </div>
        </section>

        <section className="py-12 md:py-16">
          <div className="page-gutter mx-auto max-w-6xl">
            <div
              className={surfaceCardStyles({
                padding: "lg",
                className:
                  "md:grid md:grid-cols-[minmax(0,1fr)_auto] md:gap-10",
              })}
            >
              <div>
                <p className="type-eyebrow">{t("participate.eyebrow")}</p>
                <h2 className="mt-3 type-section-title-large text-balance">
                  {t("participate.heading")}
                </h2>
                <p className="mt-3 max-w-2xl type-body-muted text-pretty">
                  {t("participate.body")}
                </p>
                <p className="mt-4 max-w-2xl type-caption text-pretty">
                  {t("participate.note")}
                </p>
              </div>
              <div className="mt-6 flex flex-col gap-3 md:mt-0 md:min-w-64 md:justify-center">
                <Link
                  href="/feedback?category=visitor"
                  prefetch={false}
                  className={buttonVariants({
                    variant: "primary",
                    tone: "cta",
                    size: "large",
                  })}
                >
                  {t("participate.visitorCta")}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href="/feedback?category=owner"
                  prefetch={false}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "large",
                  })}
                >
                  {t("participate.ownerCta")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
