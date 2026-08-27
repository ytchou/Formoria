import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildOrganizationJsonLd, safeJsonLdStringify } from "@/lib/json-ld";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { Link } from "@/i18n/navigation";
import AboutHero from "@/components/about/about-hero";
import { PullQuote } from "@/components/stories/pull-quote";
import { buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { getBrandStats, getRecentBrandCount } from "@/lib/services/brands";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { routes } from "@/lib/routes";

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
  const { canonical, languages } = buildAlternates(routes.about(), safeLocale);
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
    }),
  };
}

const SCENE_KEYS = [
  "intention",
  "encounter",
  "alternatives",
  "adjacent",
] as const;
const STANCE_KEYS = [
  "boundary",
  "noPayToWin",
  "incomplete",
  "judgment",
] as const;

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("about");
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale);

  const [stats, recentBrands] = await Promise.all([
    getBrandStats().catch(captureReadFailure("about.brandStats")),
    getRecentBrandCount().catch(captureReadFailure("about.recentBrandCount")),
  ]);

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
      <main>
        <AboutHero
          brandCount={stats?.brandCount}
          categoryCount={stats?.categoryCount}
          recentBrands={recentBrands ?? undefined}
        />

        {/* Scenes */}
        <section className="bg-surface py-section">
          <PageShell measure="page">
            <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
              <h2 className="type-page-title text-balance">
                {t("scenes.heading")}
              </h2>
              <div className="space-y-6">
                {SCENE_KEYS.map((key, i) => (
                  <div key={key}>
                    <p className="type-section">
                      {t(`scenes.items.${key}.scene`)}
                    </p>
                    <p className="mt-2 type-body-sm">
                      {t(`scenes.items.${key}.detail`)}
                    </p>
                    {i < SCENE_KEYS.length - 1 && (
                      <hr className="mt-6 border-rule" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </PageShell>
        </section>

        {/* Loop */}
        <section className="py-section">
          <PageShell measure="page">
            <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
              <h2 className="type-page-title text-balance">
                {t("loop.heading")}
              </h2>
              <div>
                <p className="type-body">{t("loop.body1")}</p>
                <p className="mt-6 type-body">{t("loop.body2")}</p>
                <PullQuote>{t("loop.pullQuote")}</PullQuote>
                <h3 className="type-section">{t("loop.brandHeading")}</h3>
                <p className="mt-4 type-body">{t("loop.brandBody")}</p>
              </div>
            </div>
          </PageShell>
        </section>

        {/* Statistics */}
        <section className="bg-surface py-section">
          <PageShell measure="page">
            <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
              <h2 className="type-page-title text-balance">
                {t("taiwanStats.heading")}
              </h2>
              <div>
                <p className="type-body">{t("taiwanStats.intro")}</p>
                <div className="mt-8 flex flex-wrap gap-14">
                  {(["count", "share", "employment"] as const).map((key) => (
                    <div key={key}>
                      <p className="type-display tabular-nums">
                        {t(`taiwanStats.items.${key}.value`)}
                      </p>
                      <p className="mt-2 type-metadata">
                        {t(`taiwanStats.items.${key}.label`)}
                      </p>
                    </div>
                  ))}
                </div>
                <hr className="mt-8 border-rule" />
                <p className="mt-4 type-metadata">
                  {t("taiwanStats.sourceLabel")}
                  {": "}
                  <a
                    href="https://www.sme.gov.tw/article-tw-2853-13097"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {t("taiwanStats.sourceName")}
                  </a>
                </p>
              </div>
            </div>
          </PageShell>
        </section>

        {/* Stance */}
        <section className="py-section">
          <PageShell measure="page">
            <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
              <h2 className="type-page-title text-balance">
                {t("stance.heading")}
              </h2>
              <div className="space-y-8">
                {STANCE_KEYS.map((key) => (
                  <div key={key}>
                    <p className="type-section">
                      {t(`stance.items.${key}.lead`)}
                    </p>
                    <p className="mt-2 type-body">
                      {t(`stance.items.${key}.body`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </PageShell>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-rule bg-surface py-section">
          <PageShell measure="page">
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="type-page-title text-balance">
                  {t("guide.heading")}
                </h2>
              </div>
              <div>
                <Link
                  href={routes.brands()}
                  className={buttonVariants({
                    variant: "primary",
                    shape: "pill",
                  })}
                >
                  {t("guide.cta")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </div>
          </PageShell>
        </section>
      </main>
    </>
  );
}
