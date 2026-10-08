"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/control-surface";
import {
  CHAIN_REGION_LABEL,
  groupStockistsByRegion,
} from "@/lib/brands/stockist-display";
import type { Stockist } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Entries past this cap render with the `hidden` attribute, never sliced out:
 * the stockist list answers "where can I buy this", so every entry must stay
 * in the server HTML even while folded. Counted across groups, in display
 * order.
 */
const MAX_VISIBLE_ENTRIES = 8;
/** Below this count the grouping is noise — entries render without subheads. */
const GROUPED_LAYOUT_MIN_STOCKISTS = 4;

/**
 * Optional city or county, then the first administrative unit after it. The
 * unit alternation tries township/town/city + district first, so a district
 * whose name contains a town or city character is not cut short. Han
 * characters are written as \u escapes to keep CJK out of component source
 * (`no-hardcoded-cjk.test.ts`): \u53F0 tai, \u81FA tai (traditional),
 * \u5E02 city, \u7E23 county, \u9109 township, \u93AE town, \u5340 district.
 */
const DISTRICT_PATTERN =
  /^(?:[\u53F0\u81FA]?\S{1,3}?[\u5E02\u7E23])?(\S{1,3}?(?:[\u9109\u93AE\u5E02]\u5340|[\u5340\u9109\u93AE\u5E02]))/;

/** Any Han character: the cue that a name or place is written in Chinese. */
const HAN_PATTERN = /\p{Script=Han}/u;

/**
 * Language of parts (WCAG 3.1.2): on an English page a Han-script name or
 * place is marked so a screen reader switches voice for it. Undefined leaves
 * the page language in force.
 */
function partLang(text: string, isEnglishPage: boolean) {
  return isEnglishPage && HAN_PATTERN.test(text) ? "zh-Hant-TW" : undefined;
}

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * The chain sentinel is a marker, not a place: it is the one region label that
 * must never print. Every entry's location line goes through this — the row
 * printed it raw until DEV-1513's review, which put CHAIN_REGION_LABEL under
 * the all-Taiwan heading of a live brand page. That value carries a retired
 * term, and the message-catalogue lock cannot see it because it arrives as
 * data, not copy.
 */
function printableRegionLabel(stockist: Stockist): string | null {
  return stockist.regionLabel && stockist.regionLabel !== CHAIN_REGION_LABEL
    ? stockist.regionLabel
    : null;
}

/**
 * The short location an entry prints: the district read out of the address
 * (a district such as Xinyi or Zhubei), the whole address when no district parses, or the region
 * label when there is no address.
 */
export function stockistDistrict(stockist: Stockist): string | null {
  if (stockist.address) {
    const compact = stockist.address.replace(/\s+/g, "").replace(/^\d+/, "");
    return compact.match(DISTRICT_PATTERN)?.[1] ?? stockist.address;
  }
  return printableRegionLabel(stockist);
}

export type StockistListProps = {
  confirmed: Stockist[];
  possible: Stockist[];
};

type ProvenanceKey = "owner" | "formoria" | "evidence" | "evidenceOther";

/**
 * No `?? "community"` fallback: `confirmedBy` is set by
 * `groupStockistsForDisplay` for every confirmed row, and guessing a
 * provenance for a row the server declined to vouch for is how a trust label
 * gets printed without anything behind it.
 */
function provenanceKeyOf(stockist: Stockist): ProvenanceKey | null {
  if (stockist.status !== "confirmed" || !stockist.confirmedBy) return null;
  return stockist.confirmedBy === "evidence" &&
    stockist.evidenceSource !== "official_website"
    ? "evidenceOther"
    : stockist.confirmedBy;
}

/**
 * The one provenance every entry shares, when the list is wholly confirmed and
 * agrees — then it prints once above the list instead of on every row.
 */
function sharedProvenanceKey(stockists: Stockist[]): ProvenanceKey | null {
  const keys = new Set(stockists.map(provenanceKeyOf));
  const [only] = keys;
  return keys.size === 1 && only ? only : null;
}

/**
 * Status is never carried by this marker alone: each entry also names it in
 * text (see `StockistEntry`). Both markers are neutral — the palette has no
 * status colour.
 */
function StatusMarker({ confirmed }: { confirmed: boolean }) {
  if (confirmed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
      >
        <Check className="size-4" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="size-5 shrink-0 rounded-full border-2 border-dashed border-ink-muted/60"
    />
  );
}

/** Chevron for a fold toggle: down while folded, up once expanded. */
function ToggleChevron({ expanded }: { expanded: boolean }) {
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <Icon
      aria-hidden="true"
      className="size-4"
      data-chevron={expanded ? "up" : "down"}
    />
  );
}

type StockistEntryProps = {
  stockist: Stockist;
  t: Translate;
  hidden: boolean;
  /** True when a summary above the list already states the provenance. */
  provenanceSummarised: boolean;
  isEnglishPage: boolean;
};

function StockistEntry({
  stockist,
  t,
  hidden,
  provenanceSummarised,
  isEnglishPage,
}: StockistEntryProps) {
  const mapsHref = stockist.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stockist.address)}`
    : null;
  // Exactly one way through per stockist, and the whole entry is it. An
  // address goes to Google Maps; without one, the stockist's own page is the
  // only way through.
  const href = mapsHref ?? stockist.url;
  const provenanceKey = provenanceKeyOf(stockist);
  const isConfirmed = stockist.status === "confirmed";
  const district = stockistDistrict(stockist);
  const districtLang = district ? partLang(district, isEnglishPage) : undefined;
  // A possible entry says so in visible text; a confirmed one says so to
  // screen readers (below), its provenance being the visible confirmation.
  const metadata: ReactNode[] = [
    district && districtLang ? (
      <span lang={districtLang}>{district}</span>
    ) : (
      district
    ),
    provenanceKey && !provenanceSummarised
      ? t(`channels.provenance.${provenanceKey}`)
      : null,
    isConfirmed ? null : t("channels.status.possible"),
  ].filter(Boolean);

  const content: ReactNode = (
    <>
      <StatusMarker confirmed={isConfirmed} />
      <span className="min-w-0 flex-1">
        {/* A retailer name is interface, not content: it labels a place you
            can go. The interface face at the label step. */}
        <span
          lang={partLang(stockist.name, isEnglishPage)}
          className="block type-label group-hover:underline group-hover:underline-offset-4"
        >
          {stockist.name}
        </span>
        {isConfirmed ? (
          <span className="sr-only">{t("channels.status.confirmed")}</span>
        ) : null}
        {metadata.length > 0 ? (
          <span className="block type-metadata">
            {metadata.map((part, index) => (
              <Fragment key={index}>
                {index > 0 ? " · " : null}
                {part}
              </Fragment>
            ))}
          </span>
        ) : null}
      </span>
      {href !== null && mapsHref === null ? (
        <ExternalLink
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted"
        />
      ) : null}
    </>
  );

  return (
    <li hidden={hidden} data-stockist-row>
      {href !== null ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "group flex min-h-11 items-center gap-3 rounded-control py-1.5",
            FOCUS_RING,
          )}
        >
          {content}
        </a>
      ) : (
        <div className="flex min-h-11 items-center gap-3 py-1.5">
          {content}
        </div>
      )}
    </li>
  );
}

export function StockistList({ confirmed, possible }: StockistListProps) {
  const t = useTranslations("brandDetail");
  const tCities = useTranslations("cities");
  const isEnglishPage = useLocale() === "en";
  const [expanded, setExpanded] = useState(false);
  const allStockists = [...confirmed, ...possible];
  const displayGroups = groupStockistsByRegion(allStockists);
  const total = allStockists.length;
  const summaryKey = sharedProvenanceKey(allStockists);

  const isFolded = (position: number) =>
    !expanded && position >= MAX_VISIBLE_ENTRIES;

  function renderEntries(stockists: Stockist[], offset: number) {
    return (
      <ul className="grid gap-x-gutter sm:grid-cols-2 lg:grid-cols-3">
        {stockists.map((stockist, index) => (
          <StockistEntry
            key={stockist.id}
            stockist={stockist}
            t={t}
            hidden={isFolded(offset + index)}
            provenanceSummarised={summaryKey !== null}
            isEnglishPage={isEnglishPage}
          />
        ))}
      </ul>
    );
  }

  // Too few entries for grouping to earn subheads: render one flat list.
  const list =
    total < GROUPED_LAYOUT_MIN_STOCKISTS ? (
      renderEntries(
        displayGroups.flatMap((group) => group.stockists),
        0,
      )
    ) : (
      <div className="space-y-6">
        {displayGroups.map((group, index) => {
          const offset = displayGroups
            .slice(0, index)
            .reduce((sum, previous) => sum + previous.stockists.length, 0);
          const heading =
            group.key === "overseas" || group.key === "all_taiwan"
              ? t(`channels.groups.${group.key}`)
              : tCities(group.key);

          return (
            <div
              key={group.key}
              className="space-y-2"
              data-stockist-kind={group.key}
              hidden={isFolded(offset)}
            >
              {/* The count sits beside the heading, not inside it: the
                  heading names the region alone. */}
              <div className="flex items-baseline gap-2">
                <h4 className="type-label">{heading}</h4>
                <span className="type-metadata">
                  {t("channels.groups.count", {
                    count: group.stockists.length,
                  })}
                </span>
              </div>
              {renderEntries(group.stockists, offset)}
            </div>
          );
        })}
      </div>
    );

  return (
    <div className="space-y-4" data-stockist-list>
      {summaryKey ? (
        <p className="type-metadata">
          {t(`channels.provenanceSummary.${summaryKey}`)}
        </p>
      ) : null}
      {list}
      {total > MAX_VISIBLE_ENTRIES ? (
        <Button
          type="button"
          variant="secondary"
          size="compact"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? t("channels.collapse")
            : t("channels.showAll", { count: total })}
          <ToggleChevron expanded={expanded} />
        </Button>
      ) : null}
    </div>
  );
}
