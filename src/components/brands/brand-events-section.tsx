import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import { formatEventDateRange } from "@/components/events/event-date";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandEventParticipation } from "@/lib/services/events";
import { routes } from "@/lib/routes";

export type BrandEventsSectionProps = {
  locale: AppLocale;
  participations: BrandEventParticipation[];
};

/**
 * Server-only, by design: the whole section is static markup, so the brand page
 * gains a section without gaining a client chunk. It must render with JS off —
 * an event appearance is a verifiable, brand-unique fact and an internal link
 * into the event surface, so it has to be in the server HTML for crawlers.
 */
export async function BrandEventsSection({
  locale,
  participations,
}: BrandEventsSectionProps) {
  // Second guard behind the page-level conditional: most approved brands have
  // no event link at all, and the contract is an ABSENT section, not an empty
  // one with a heading over nothing.
  if (participations.length === 0) return null;

  const t = await getTranslations({
    locale,
    namespace: "brandDetail.events",
  });
  const isEnglish = locale === "en";

  return (
    <section className="space-y-6" data-brand-events>
      <div className="space-y-2">
        <Typography as="h2" variant="sectionTitle">
          {t("heading")}
        </Typography>
        <Typography as="p" variant="cardDescription">
          {t("note")}
        </Typography>
      </div>

      <ul className="list-none space-y-4 p-0">
        {participations.map((participation) => {
          // English copy is optional per column, so each one falls back
          // independently: an event with an English name but no English area
          // should still show the English name rather than dropping to zh-TW
          // wholesale.
          const name = isEnglish
            ? (participation.eventNameEn ?? participation.eventName)
            : participation.eventName;
          const area = isEnglish
            ? (participation.areaEn ?? participation.area)
            : participation.area;
          // `''` for an unparseable date column — the row drops the line rather
          // than rendering "Invalid Date" or an empty element.
          const dateLabel = formatEventDateRange(
            participation.startsOn,
            participation.endsOn,
          );
          const booth = participation.booth?.trim();

          return (
            <li key={participation.eventSlug} className="space-y-1">
              {/*
                Internal link, so no `target="_blank"` and no `rel="noopener"`:
                an e2e sweep asserts those on external anchors only. `href` is
                unprefixed — next-intl's `Link` applies the active locale.
              */}
              <Link
                href={routes.event(participation.eventSlug)}
                className="type-card-title hover:underline"
              >
                {name}
              </Link>
              {dateLabel ? <p className="type-metadata">{dateLabel}</p> : null}
              <div className="flex flex-wrap gap-x-3 type-metadata">
                {booth ? <span>{t("boothLabel", { booth })}</span> : null}
                {area ? <span>{area}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
