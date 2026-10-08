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
import { actionLinkStyles } from "@/components/ui/action-link";
import { buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PhotoBand } from "@/components/ui/photo-band";
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
              <h2 className="type-section text-balance [word-break:auto-phrase]">
                {t("scenes.heading")}
              </h2>
              <div className="space-y-6">
                {SCENE_KEYS.map((key, i) => (
                  <div key={key}>
                    <p className="type-card-title text-balance [word-break:auto-phrase]">
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
              <h2 className="type-section text-balance [word-break:auto-phrase]">
                {t("loop.heading")}
              </h2>
              <div>
                <p className="type-body">{t("loop.body1")}</p>
                <p className="mt-6 type-body">{t("loop.body2")}</p>
                <PullQuote>{t("loop.pullQuote")}</PullQuote>
                <h3 className="type-card-title text-balance [word-break:auto-phrase]">
                  {t("loop.brandHeading")}
                </h3>
                <p className="mt-4 type-body">{t("loop.brandBody")}</p>
              </div>
            </div>
          </PageShell>
        </section>

        {/* Statistics */}
        <section className="bg-surface py-section">
          <PageShell measure="page">
            <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
              <h2 className="type-section text-balance [word-break:auto-phrase]">
                {t("taiwanStats.heading")}
              </h2>
              <div>
                <p className="type-body">{t("taiwanStats.intro")}</p>
                {/* One figure per row at every width. A wrapping row of three
                    broke 2 + 1 at 390px and stranded the last figure; three
                    columns do not fit the 46px figures in this column, which
                    caps at 660px (the EN "Nearly 80%" alone is ~240px). */}
                <div className="mt-8 divide-y divide-rule border-y border-rule">
                  {(["count", "share", "employment"] as const).map((key) => (
                    <div key={key} className="py-6">
                      <p className="type-display tabular-nums">
                        {t(`taiwanStats.items.${key}.value`)}
                      </p>
                      <p className="mt-2 type-metadata">
                        {t(`taiwanStats.items.${key}.label`)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 type-metadata">
                  {t.rich("taiwanStats.source", {
                    link: (chunks) => (
                      <a
                        href="https://www.sme.gov.tw/article-tw-2853-13097"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </div>
            </div>
          </PageShell>
        </section>

        <PhotoBand
          image="/images/about-rush-clay.webp"
          alt=""
          scrim="decorative"
          className="h-90 py-0"
        />

        {/* Stance */}
        <section className="py-section">
          <PageShell measure="page">
            <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
              <h2 className="type-section text-balance [word-break:auto-phrase]">
                {t("stance.heading")}
              </h2>
              <div className="space-y-8">
                {STANCE_KEYS.map((key) => (
                  <div key={key}>
                    <p className="type-card-title text-balance [word-break:auto-phrase]">
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
                <h2 className="type-section text-balance [word-break:auto-phrase]">
                  {t("guide.heading")}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link
                  href={routes.style()}
                  className={buttonVariants({
                    variant: "primary",
                    shape: "pill",
                  })}
                >
                  {t("guide.cta")}
                  <ArrowRight aria-hidden="true" />
                </Link>
                <div className="flex items-center gap-3">
                  <span className="type-metadata text-ink-soft">
                    {t("guide.directoryPrefix")}
                  </span>
                  <Link href={routes.brands()} className={actionLinkStyles()}>
                    {t("guide.directoryCta")}
                  </Link>
                </div>
              </div>
            </div>
          </PageShell>
        </section>
      </main>
    </>
  );
}
