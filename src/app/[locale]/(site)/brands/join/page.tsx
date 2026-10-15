import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";
import { Link } from "@/i18n/navigation";
import { BrandCard } from "@/components/brands/brand-card";
import { buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { routes } from "@/lib/routes";
import { getRandomBrands } from "@/lib/services/brands";
import { splitTrustLabel } from "@/lib/text/split-trust-label";

// Bounds the edge copy to an hour under the Cloudflare HTML cache rule
// (DEV-1961); without it Next sends s-maxage=31536000.
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("brandsJoin");

  return buildPageMetadata({
    locale,
    path: "/brands/join",
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

const VALUE_PROP_KEYS = [1, 2, 3] as const;

const TRUST_LABEL_KEYS = [
  "trustLabelDirectory",
  "trustLabelSelection",
  "trustLabelProvided",
  "trustLabelSponsored",
  "trustLabelSiteConfirmed",
] as const;

const STEP_KEYS = [
  "howItWorksStep1",
  "howItWorksStep2",
  "howItWorksStep3",
] as const;

/**
 * The recruitment CTA, shown under the hero and again at the close. Same
 * shape and size as the recommend form's submit button it leads to (SP2-23).
 */
function RecommendCta({ label, note }: { label: string; note: string }) {
  return (
    <>
      <Link
        href={routes.submit.recommend()}
        className={buttonVariants({ variant: "primary" })}
      >
        {label}
        <ArrowRight aria-hidden="true" />
      </Link>
      <p className="mt-3 type-body-sm text-ink-soft">{note}</p>
    </>
  );
}

export default async function BrandsJoinPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("brandsJoin");

  // One real approved brand as the example listing (SP2-09). Random among
  // approved brands, never picked by any editorial or responsiveness signal;
  // it changes at most once per revalidate window. No brand, no example.
  const exampleBrands = await getRandomBrands(1).catch(
    captureReadFailure("brandsJoin.exampleBrand"),
  );
  if (exampleBrands === null) {
    await markRenderDegraded("brandsJoin");
  }
  const exampleBrand = exampleBrands?.at(0) ?? null;

  return (
    <PageShell as="main" measure="page">
      {/* Hero. Bottom padding is a stack gap, not a section gap: the value
          props below explain the hero, and a doubled section gap left a void.
          The CTA sits under the lede so a convinced owner need not scroll
          past the whole explainer (SP2-06). */}
      <section className="pt-section pb-stack">
        <p className="type-metadata text-ink-muted">{t("heroSubtitle")}</p>
        {/* `break-keep` plus the zh message's `<wbr>`: a 390px screen wraps
            only between the two phrases, never inside a word (SP2-10). */}
        <h1 className="mt-3 type-page-title text-balance break-keep">
          {t.rich("heading", { wbr: () => <wbr /> })}
        </h1>
        <p className="mt-6 type-lede">{t("heroDescription")}</p>
        <div className="mt-8">
          <RecommendCta label={t("ctaLabel")} note={t("ctaDescription")} />
        </div>
      </section>

      {/* Value propositions */}
      <section className="pb-section">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-12">
          {VALUE_PROP_KEYS.map((n) => (
            <div key={n}>
              {/* h2 by outline (no heading sits between it and the h1),
                  card size by look, so it steps below the section h2s and
                  the page reads h1 → section → card (SP2-07). */}
              <h2 className="type-card-title">
                {t(`valueProp${n}Title`)}
              </h2>
              <p className="mt-2 type-body-sm text-ink-soft">
                {t(`valueProp${n}Description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust labels */}
      <section className="border-t border-rule py-section">
        <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
          <div>
            <h2 className="type-section text-balance">
              {t("trustLabelsHeading")}
            </h2>
            {exampleBrand ? (
              <figure className="mt-6 content-column">
                <figcaption className="mb-3 type-metadata text-ink-muted">
                  {t("exampleLabel")}
                </figcaption>
                <BrandCard brand={exampleBrand} listSource="brands_join_example" />
              </figure>
            ) : null}
          </div>
          <dl className="space-y-6">
            {TRUST_LABEL_KEYS.map((key) => {
              const { term, description: desc } = splitTrustLabel(t(key));
              return (
                <div key={key}>
                  <dt className="type-body font-semibold">{term}</dt>
                  {desc ? <dd className="mt-1 type-body">{desc}</dd> : null}
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-rule py-section">
        <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_minmax(0,660px)] md:gap-20">
          <h2 className="type-section text-balance">
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

      {/* CTA. Points straight at the recommend form: the owner flow has not
          shipped, and /submit only offered a coming-soon card for it. */}
      <section className="border-t border-rule py-section">
        <RecommendCta label={t("ctaLabel")} note={t("ctaDescription")} />
      </section>
    </PageShell>
  );
}
