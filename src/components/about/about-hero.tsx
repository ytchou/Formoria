import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { actionLinkStyles } from "@/components/ui/action-link";
import { buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { routes } from "@/lib/routes";

interface AboutHeroProps {
  /** Omitted when the count could not be read — renders no figure rather than a false zero. */
  brandCount?: number;
  /** Omitted when the count could not be read — renders no figure rather than a false zero. */
  categoryCount?: number;
  recentBrands?: { count: number; period: "7d" | "30d" };
}

export default async function AboutHero({
  brandCount,
  categoryCount,
  recentBrands,
}: AboutHeroProps) {
  const t = await getTranslations("about.hero");

  // Each figure renders as its own whole sentence, so a missing count drops a
  // sentence instead of leaving a fragment or a dangling separator.
  const fact =
    brandCount != null && categoryCount != null
      ? t("statsBoth", { brands: brandCount, categories: categoryCount })
      : brandCount != null
        ? t("statsBrands", { count: brandCount })
        : categoryCount != null
          ? t("statsCategories", { count: categoryCount })
          : null;
  const recent =
    recentBrands != null && recentBrands.count > 0
      ? t(recentBrands.period === "7d" ? "recentWeek" : "recentMonth", {
          count: recentBrands.count,
        })
      : null;

  return (
    /*
      NO BACKGROUND PHOTOGRAPH, AND DO NOT PUT ONE BACK.

      This band used to be a full-bleed stock image under a 70%/45% paper scrim.
      Two costs, both real: the scrim was the only thing making the title legible,
      so contrast depended on an image nobody re-checked when it changed; and a
      decorative photo behind an editorial statement is exactly the generic
      surface v2 exists to remove. The opening is the sentence, on paper.
    */
    <section className="py-section">
      <PageShell measure="page">
        <div className="prose-measure">
          {/*
            The deliberate line break is a `<br>` shown from `sm` up only; below
            `sm` the browser balances the lines itself. `keep-all` stops
            mid-word CJK breaks, so lines break only after an ideographic comma
            or at the `<wbr>` the message places between phrases; `wrap-break-word`
            still breaks a phrase rather than overflow a narrow viewport.
            `auto-phrase` is not used here: Chromium segments only Japanese
            with it, so for zh-TW it behaves as `normal`.
          */}
          <h1 className="type-display text-balance wrap-break-word [word-break:keep-all]">
            {t.rich("title", {
              br: () => <br className="max-sm:hidden" />,
              wbr: () => <wbr />,
            })}
          </h1>
          <p className="mt-4 type-body text-ink-soft text-pretty">
            {t("subtitle")}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href={routes.discover()}
              className={buttonVariants({
                variant: "primary",
                shape: "pill",
              })}
            >
              {t("cta")}
              <ArrowRight aria-hidden="true" />
            </Link>
            <div className="flex items-center gap-3">
              <span className="type-metadata text-ink-soft">
                {t("directoryPrefix")}
              </span>
              <Link href={routes.brands()} className={actionLinkStyles()}>
                {t("directoryCta")}
              </Link>
            </div>
          </div>

          {(fact != null || recent != null) && (
            <p className="mt-6 flex flex-wrap gap-x-3 type-metadata">
              {fact != null && <span>{fact}</span>}
              {recent != null && <span className="text-accent">{recent}</span>}
            </p>
          )}
        </div>
      </PageShell>
    </section>
  );
}
