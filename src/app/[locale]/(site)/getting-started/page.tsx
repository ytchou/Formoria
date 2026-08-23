import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { OwnerBenefitsSection } from "@/components/getting-started/OwnerBenefitsSection";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { routes } from "@/lib/routes";

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
  const t = await getTranslations("gettingStarted.metadata");
  const title = t("title");
  const description = t("description");
  const { canonical, languages } = buildAlternates(
    routes.gettingStarted(),
    safeLocale,
  );
  const ogLocale = safeLocale === "en" ? "en_US" : "zh_TW";
  const ogAlternateLocale = safeLocale === "en" ? "zh_TW" : "en_US";

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

export default async function GettingStartedPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("gettingStarted");

  const steps = ["discover", "submit", "review", "manage"] as const;
  const tips = ["accurate", "photos", "links"] as const;
  const stepCtas: Partial<
    Record<(typeof steps)[number], { href: string; label: string }>
  > = {
    discover: { href: routes.brands(), label: t("steps.discover.cta") },
    submit: { href: routes.brands(), label: t("steps.submit.cta") },
  };

  return (
    <PageShell as="main" measure="page" className="py-10">
      <section className="grid gap-8 border-b border-rule pb-10 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
        <div className="prose-measure">
          <p className="type-eyebrow">{t("hero.eyebrow")}</p>
          <h1 className="mt-3 type-display">{t("hero.title")}</h1>
          <p className="mt-4 type-body">{t("hero.intro")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <Link
            href={routes.brands()}
            className={buttonVariants({ variant: "primary" })}
          >
            {t("hero.primaryCta")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href={routes.faq()}
            className={buttonVariants({ variant: "secondary" })}
          >
            {t("hero.secondaryCta")}
          </Link>
        </div>
      </section>

      <section className="py-10">
        <h2 className="type-section">{t("steps.heading")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {steps.map((step, index) => {
            const cta = stepCtas[step];

            return (
              <article key={step} className={surfaceCardStyles()}>
                <div className="flex size-8 items-center justify-center rounded-full bg-accent type-body-sm font-semibold text-ground">
                  {index + 1}
                </div>
                <h3 className="mt-4 type-card-title">
                  {t(`steps.${step}.title`)}
                </h3>
                <p className="mt-2 type-body-sm">
                  {t(`steps.${step}.body`)}
                </p>
                {cta ? (
                  <Link
                    href={cta.href}
                    className={buttonVariants({
                      variant: "secondary",
                      size: "large",
                      className: "mt-5 w-fit",
                    })}
                  >
                    {cta.label}
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-8 border-t border-rule py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="type-section">{t("tips.heading")}</h2>
        {/* The reading track of a two-track section. Nothing above it caps a
            width, so uncapped it takes the page measure less the 18rem heading
            rail — about 1150px of unbroken line at 1920. */}
        <ul className="prose-measure grid gap-3">
          {tips.map((tip) => (
            <li key={tip} className="flex gap-3 type-body-sm">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-accent"
              />
              <span>{t(`tips.${tip}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-8 border-t border-rule py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="type-section">{t("forOwners.heading")}</h2>
        <OwnerBenefitsSection />
      </section>

      <section
        className={surfaceCardStyles({
          className: "md:flex md:items-center md:justify-between md:gap-8",
          padding: "lg",
        })}
      >
        <div>
          <h2 className="type-section">{t("cta.heading")}</h2>
          <p className="mt-2 prose-measure type-body-sm">{t("cta.body")}</p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row md:mt-0">
          <Link
            href={routes.brands()}
            className={buttonVariants({ variant: "primary" })}
          >
            {t("cta.browse")}
          </Link>
          <Link
            href={`${routes.about()}#vision`}
            className={buttonVariants({ variant: "secondary" })}
          >
            {t("cta.about")}
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
