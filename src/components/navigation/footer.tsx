import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getFooterFullDocumentHref } from "./footer-links";
import { routes } from "@/lib/routes";

export function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();

  return (
    <footer role="contentinfo" className="border-t border-border bg-card">
      {/* Not `page-shell`: that is a fixed 100rem, and every non-landing
          `<main>` caps at 80rem, so a fixed footer measure diverged from the
          content above it by up to 160px on `/brands`, `/about` and the rest.
          `page-measure` reads `--page-measure` from globals.css, which defaults
          to 80rem; the landing page raises it to 100rem by marking its `<main>`
          with `data-page-measure="wide"`. The `<main>` elements now read the
          same utility, so the footer and the page above it move together. */}
      <div className="page-gutter mx-auto w-full page-measure py-12">
        {/* Multi-column link grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Discover */}
          <div>
            <p className="type-metadata font-semibold uppercase tracking-wider text-ink">{t("discoverHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href={routes.brands()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("directory")}
                </Link>
              </li>
              <li>
                <Link
                  href={routes.whereToBuy()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("whereToBuy")}
                </Link>
              </li>
              <li>
                <Link
                  href={routes.discover()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("discover")}
                </Link>
              </li>
              <li>
                <a
                  href={getFooterFullDocumentHref(routes.events(), locale)}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("events")}
                </a>
              </li>
              <li>
                <a
                  href={getFooterFullDocumentHref(routes.stories(), locale)}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("stories")}
                </a>
              </li>
              <li>
                <Link
                  href={routes.submit.index()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("submit")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="type-metadata font-semibold uppercase tracking-wider text-ink">{t("companyHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href={routes.about()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("about")}
                </Link>
              </li>
              <li>
                <Link
                  href={routes.gettingStarted()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("gettingStarted")}
                </Link>
              </li>
              <li>
                <Link
                  href={routes.faq()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("faq")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="type-metadata font-semibold uppercase tracking-wider text-ink">{t("legalHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href={routes.terms()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link
                  href={routes.privacy()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("privacy")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div>
            <p className="type-metadata font-semibold uppercase tracking-wider text-ink">{t("connectHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href={routes.contact()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("contact")}
                </Link>
              </li>
              <li>
                <Link
                  href={routes.featureRequests()}
                  prefetch={false}
                  className="type-body-sm hover:text-foreground transition-colors"
                >
                  {t("feedback")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar: tagline + copyright */}
        <div className="mt-10 flex flex-col items-start gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-body-sm">{t("tagline")}</p>
          <p className="type-metadata">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
