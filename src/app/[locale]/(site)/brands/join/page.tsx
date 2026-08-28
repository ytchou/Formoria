import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { routes } from "@/lib/routes";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("brandsJoin");
  const title = t("metaTitle");
  const description = t("metaDescription");
  const { canonical, languages } = buildAlternates(
    "/brands/join",
    safeLocale,
  );
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

const VALUE_PROP_KEYS = [1, 2, 3] as const;

const TRUST_LABEL_KEYS = [
  "trustLabelDirectory",
  "trustLabelSelection",
  "trustLabelProvided",
] as const;

const STEP_KEYS = [
  "howItWorksStep1",
  "howItWorksStep2",
  "howItWorksStep3",
] as const;

export default async function BrandsJoinPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("brandsJoin");

  return (
    <PageShell as="main" measure="page">
      {/* Hero */}
      <section className="py-section text-center">
        <p className="type-metadata text-muted">{t("heroSubtitle")}</p>
        <h1 className="mt-3 type-page-title text-balance">
          {t("heading")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl type-body text-muted">
          {t("heroDescription")}
        </p>
      </section>

      {/* Value propositions */}
      <section className="py-section">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-12">
          {VALUE_PROP_KEYS.map((n) => (
            <div key={n}>
              <h2 className="type-section">
                {t(`valueProp${n}Title`)}
              </h2>
              <p className="mt-2 type-body-sm text-muted">
                {t(`valueProp${n}Description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust labels */}
      <section className="border-t border-rule py-section">
        <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
          <h2 className="type-page-title text-balance">
            {t("trustLabelsHeading")}
          </h2>
          <dl className="space-y-6">
            {TRUST_LABEL_KEYS.map((key) => (
              <dd key={key} className="type-body">
                {t(key)}
              </dd>
            ))}
          </dl>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-rule py-section">
        <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
          <h2 className="type-page-title text-balance">
            {t("howItWorksHeading")}
          </h2>
          <ol className="space-y-6">
            {STEP_KEYS.map((key, i) => (
              <li key={key} className="type-body">
                <span className="mr-2 font-semibold">{i + 1}.</span>
                {t(key)}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-rule py-section text-center">
        <Link
          href={routes.submit.index()}
          className={buttonVariants({
            variant: "primary",
            size: "large",
            shape: "pill",
          })}
        >
          {t("ctaLabel")}
          <ArrowRight aria-hidden="true" />
        </Link>
        <p className="mt-4 type-body-sm text-muted">{t("ctaDescription")}</p>
      </section>
    </PageShell>
  );
}
