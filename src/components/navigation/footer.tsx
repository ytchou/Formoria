import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getFooterFullDocumentHref } from "./footer-links";
import { routes } from "@/lib/routes";

/**
 * The footer is the page's one ink ground, so every colour here comes from the
 * inverted ramp: `text-on-ink` for links, `text-on-ink-muted` for the fine
 * print, `border-rule-on-ink` for the divider. THE ACCENT NEVER APPEARS ON
 * INK — `accent` against `ink` is barely two luminance points apart, so it
 * would read as invisible rather than as a control. That includes the focus
 * ring, which uses `on-ink` here instead.
 *
 * `rule-on-ink` is a non-text rule only. It does not meet a text contrast floor
 * and must never carry type.
 */
const linkClasses =
  "inline-flex min-h-11 items-center type-nav text-on-ink hover:underline underline-offset-4 rounded-[2px] focus-visible:ring-2 focus-visible:ring-on-ink focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

const columnHeadingClasses = "type-eyebrow text-on-ink-muted";

export function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();

  return (
    <footer role="contentinfo" className="bg-ink py-section">
      {/* Not a fixed 100rem cap: every non-landing `<main>` caps at 80rem, so
          a fixed footer measure diverged from the content above it by up to
          160px on `/brands`, `/about` and the rest.
          `page-measure` reads `--page-measure` from globals.css, which defaults
          to 80rem; the landing page raises it to 100rem by marking its `<main>`
          with `data-page-measure="wide"`. The `<main>` elements now read the
          same utility, so the footer and the page above it move together. */}
      <div className="page-gutter mx-auto w-full page-measure">
        <div className="flex flex-col gap-stack lg:flex-row lg:gap-16">
          {/* The wordmark and the consumer promise. The content face
              (`font-ming`) on both: this is the only content on the page's
              last screen, not chrome. */}
          <div className="lg:w-1/3">
            <p className="type-card-title text-on-ink">Formoria</p>
            {/* `footer.tagline` is byte-pinned by brand-identity-copy.test.ts
                as the canonical promise derivative — do not punctuate it here. */}
            <p className="mt-4 type-body-sm text-on-ink-muted">{t("tagline")}</p>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-stack sm:grid-cols-3">
            {/* Discover */}
            <div>
              <p className={columnHeadingClasses}>{t("discoverHeading")}</p>
              <ul className="mt-4 flex list-none flex-col p-0">
                <li>
                  <Link href={routes.discover()} prefetch={false} className={linkClasses}>
                    {t("discover")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.brands()} prefetch={false} className={linkClasses}>
                    {t("directory")}
                  </Link>
                </li>
                <li>
                  {/* Full-document navigation, not a client transition: the
                      stories and events hubs are statically rendered and the
                      soft transition re-fetched them on every footer click. */}
                  <a
                    href={getFooterFullDocumentHref(routes.stories(), locale)}
                    className={linkClasses}
                  >
                    {t("stories")}
                  </a>
                </li>
                <li>
                  <Link href={routes.whereToBuy()} prefetch={false} className={linkClasses}>
                    {t("whereToBuy")}
                  </Link>
                </li>
                <li>
                  <a
                    href={getFooterFullDocumentHref(routes.events(), locale)}
                    className={linkClasses}
                  >
                    {t("events")}
                  </a>
                </li>
              </ul>
            </div>

            {/* About */}
            <div>
              <p className={columnHeadingClasses}>{t("companyHeading")}</p>
              <ul className="mt-4 flex list-none flex-col p-0">
                <li>
                  <Link href={routes.about()} prefetch={false} className={linkClasses}>
                    {t("about")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.gettingStarted()} prefetch={false} className={linkClasses}>
                    {t("gettingStarted")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.faq()} prefetch={false} className={linkClasses}>
                    {t("faq")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.submit.index()} prefetch={false} className={linkClasses}>
                    {t("submit")}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Contact — the legal column folded in with it, as in the mock. */}
            <div>
              <p className={columnHeadingClasses}>{t("connectHeading")}</p>
              <ul className="mt-4 flex list-none flex-col p-0">
                <li>
                  <Link href={routes.contact()} prefetch={false} className={linkClasses}>
                    {t("contact")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.featureRequests()} prefetch={false} className={linkClasses}>
                    {t("feedback")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.terms()} prefetch={false} className={linkClasses}>
                    {t("terms")}
                  </Link>
                </li>
                <li>
                  <Link href={routes.privacy()} prefetch={false} className={linkClasses}>
                    {t("privacy")}
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Copyright and the non-seller disclosure. The disclosure is not fine
            print by accident: Formoria never owns the transaction, and this is
            the one line that says so on every route. */}
        <div className="mt-stack flex flex-col items-start gap-3 border-t border-rule-on-ink pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-metadata text-on-ink-muted">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
          <p className="type-metadata text-on-ink-muted">{t("disclosure")}</p>
        </div>
      </div>
    </footer>
  );
}
