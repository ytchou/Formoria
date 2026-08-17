import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getFooterFullDocumentHref } from "./footer-links";

export function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();

  return (
    <footer role="contentinfo" className="border-t border-border bg-card">
      {/* Not `page-shell`: that is a fixed 100rem, and every non-landing
          `<main>` caps at `max-w-screen-xl` (80rem), so a fixed footer measure
          diverged from the content above it by up to 160px on `/brands`,
          `/about` and the rest. `--page-measure` is declared in globals.css and
          defaults to 80rem; the landing page raises it to 100rem by marking its
          `<main>` with `data-page-measure="wide"`. */}
      <div className="page-gutter mx-auto w-full max-w-[var(--page-measure)] py-12">
        {/* Multi-column link grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Discover */}
          <div>
            <p className="type-eyebrow-foreground">{t("discoverHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/brands"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("directory")}
                </Link>
              </li>
              <li>
                <Link
                  href="/where-to-buy"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("whereToBuy")}
                </Link>
              </li>
              <li>
                <Link
                  href="/discover"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("discover")}
                </Link>
              </li>
              <li>
                <a
                  href={getFooterFullDocumentHref("/events", locale)}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("events")}
                </a>
              </li>
              <li>
                <a
                  href={getFooterFullDocumentHref("/stories", locale)}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("stories")}
                </a>
              </li>
              <li>
                <Link
                  href="/submit"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("submit")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="type-eyebrow-foreground">{t("companyHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/about"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("about")}
                </Link>
              </li>
              <li>
                <Link
                  href="/getting-started"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("gettingStarted")}
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("faq")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="type-eyebrow-foreground">{t("legalHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/terms"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("privacy")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div>
            <p className="type-eyebrow-foreground">{t("connectHeading")}</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/contact"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("contact")}
                </Link>
              </li>
              <li>
                <Link
                  href="/feature-requests"
                  prefetch={false}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t("feedback")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar: tagline + copyright */}
        <div className="mt-10 flex flex-col items-start gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-card-description">{t("tagline")}</p>
          <p className="type-caption">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
