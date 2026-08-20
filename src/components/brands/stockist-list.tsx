"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown, ExternalLink, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  getStockistViewerStateAction,
  ownerModerateStockistAction,
} from "@/app/[locale]/(site)/brands/[slug]/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useUser } from "@/lib/auth/use-user";
import {
  CHAIN_REGION_LABEL,
  groupStockistsByRegion,
  type StockistRegionGroup,
} from "@/lib/brands/stockist-display";
import type { Stockist } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_CHIPS = 6;
/** Below this count the grouping is noise — entries render without headings. */
const GROUPED_LAYOUT_MIN_STOCKISTS = 4;
/** Chain marker written by the enrichment phase; it carries no location worth repeating. */
const CHAIN_MARKER = CHAIN_REGION_LABEL;

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export type StockistListProps = {
  confirmed: Stockist[];
  possible: Stockist[];
  brandId: string;
  brandSlug: string;
};

function getActionErrorMessage(
  error: unknown,
  translateError: (key: string) => string,
): string {
  if (error instanceof Error && error.message && error.message !== "unknown") {
    try {
      return translateError(error.message);
    } catch {
      return error.message;
    }
  }

  return translateError("unknown");
}

function StatusMarker({ confirmed }: { confirmed: boolean }) {
  if (confirmed) {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-verified-green-bg text-verified-green"
      >
        <Check className="size-4" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-dashed border-ink-muted/60"
    />
  );
}

type StockistListRowProps = {
  stockist: Stockist;
  isPending: boolean;
  isOwner: boolean;
  error: string | undefined;
  t: Translate;
  ownerConfirmLabel: string;
  ownerRejectLabel: string;
  onModerate: (stockist: Stockist, status: "confirmed" | "rejected") => void;
};

function StockistListRow({
  stockist,
  isPending,
  isOwner,
  error,
  t,
  ownerConfirmLabel,
  ownerRejectLabel,
  onModerate,
}: StockistListRowProps) {
  // Every stockist is a physical place since DEV-1513, so the address is always
  // the location worth printing and the region label is its fallback.
  const region = stockist.address ?? stockist.regionLabel;
  const mapsHref = stockist.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stockist.address)}`
    : null;
  // Only a rendered Maps link counts as a way through.
  const showsMapsLink = region !== null && mapsHref !== null;
  // The href itself rather than a boolean beside it: `stockist.url` is
  // `string | null`, and a separate flag proves nothing to the compiler at the
  // point of use — the anchor below needs the narrowing, not the answer.
  const outboundHref = showsMapsLink ? null : stockist.url;
  // No `?? "community"` fallback: `confirmedBy` is set by
  // `groupStockistsForDisplay` for every confirmed row and read only here, and
  // guessing a provenance for a row the server declined to vouch for is how a
  // trust label gets printed without anything behind it.
  const provenanceKey =
    stockist.confirmedBy === "evidence" &&
    stockist.evidenceSource !== "official_website"
      ? "evidenceOther"
      : stockist.confirmedBy;
  const isConfirmed = stockist.status === "confirmed";

  return (
    <div
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
      data-stockist-row
    >
      <div className="flex min-w-0 items-start gap-3">
        <StatusMarker confirmed={isConfirmed} />
        <div className="min-w-0">
          <p className="type-label">{stockist.name}</p>
          {region ? (
            <div className="mt-2 type-body-sm text-ink-soft">
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {region}
                </a>
              ) : (
                <span>{region}</span>
              )}
            </div>
          ) : null}
          {error ? (
            <p className="mt-2 type-metadata text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {isConfirmed && provenanceKey ? (
          <Badge variant="success">
            {t(`channels.provenance.${provenanceKey}`)}
          </Badge>
        ) : null}
        {/* Exactly one way through per stockist. When the address renders as a
            Google Maps link that IS the way through, so the outbound button
            would send the reader to a second page saying the same thing. When
            there is no rendered address, the outbound link is the only way
            through and it stays. */}
        {outboundHref !== null ? (
          <a
            href={outboundHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: "secondary",
              size: "compact",
              className: "min-h-12",
            })}
          >
            {t("channels.confirmed.officialPageLink")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
        {!isConfirmed && isOwner ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-pressed={stockist.ownerStatus === "confirmed"}
              disabled={isPending}
              onClick={() => onModerate(stockist, "confirmed")}
            >
              <Check aria-hidden="true" className="size-4" />
              {ownerConfirmLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-pressed={stockist.ownerStatus === "rejected"}
              disabled={isPending}
              onClick={() => onModerate(stockist, "rejected")}
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {ownerRejectLabel}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

type StockistChipProps = {
  stockist: Stockist;
  t: Translate;
};

function StockistChip({ stockist, t }: StockistChipProps) {
  const isConfirmed = stockist.status === "confirmed";
  // The chain sentinel is a marker, not a place, so it is the one region label
  // that never prints.
  const region =
    stockist.regionLabel && stockist.regionLabel !== CHAIN_MARKER
      ? stockist.regionLabel
      : null;
  const mapsHref = stockist.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stockist.address)}`
    : null;
  // Same rule as the row: the outbound icon is a fallback, not a duplicate.
  const showsMapsLink = region !== null && mapsHref !== null;
  // Held as the href, not as a boolean — see the row above.
  const outboundHref = showsMapsLink ? null : stockist.url;

  return (
    <li
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5",
        isConfirmed
          ? "border-rule bg-verified-green-bg text-verified-green"
          : "border-dashed border-rule",
      )}
      data-stockist-chip
    >
      {isConfirmed ? (
        <Check aria-hidden="true" className="size-3.5 shrink-0" />
      ) : null}
      {/* A retailer name is interface, not content: it labels a place you can
          go, and it sits inside a chip beside a state marker. The interface
          face at the label step, not the content face at a body step. */}
      <span className="type-label">{stockist.name}</span>
      {region ? (
        <span className="type-metadata text-ink-muted">
          (
          {mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-ink"
            >
              {region}
            </a>
          ) : (
            region
          )}
          )
        </span>
      ) : null}
      {/* A location with a printed region reaches its destination through the
          Maps link above, so the icon would duplicate it. Without that link — a
          chip whose region is the chain sentinel or unknown — this icon is the
          only way through. */}
      {outboundHref !== null ? (
        <a
          href={outboundHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${stockist.name} ${t("channels.confirmed.officialPageLink")}`}
          // ::after grows the 32px icon to a 44px touch target, the same way the
          // confirm button below and `ui/switch` do it — the visible mark stays
          // small because it sits inside a dense chip row, but the target does
          // not. The accessible name comes from `aria-label` and names the
          // ACTION plus the stockist it acts on, not the glyph.
          className="relative inline-flex min-h-8 min-w-8 items-center justify-center text-ink-muted after:absolute after:-inset-1.5 after:content-[''] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      ) : null}
    </li>
  );
}

export function StockistList({
  confirmed,
  possible,
  brandId,
  brandSlug,
}: StockistListProps) {
  const t = useTranslations("brandDetail");
  const tErrors = useTranslations("brandDetail.channels.errors");
  const tCities = useTranslations("cities");
  const { user, loading } = useUser();
  const [, startTransition] = useTransition();
  const allStockists = [...confirmed, ...possible];
  const [expandedChipGroups, setExpandedChipGroups] = useState<
    Partial<Record<string, boolean>>
  >({});
  const [isOwner, setIsOwner] = useState(false);
  const [pendingStockistId, setPendingStockistId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (loading || !user) return;

    let active = true;
    void getStockistViewerStateAction(brandId)
      .then((viewerState) => {
        if (!active) return;
        setIsOwner(viewerState.isOwner);
      })
      .catch(() => {
        // Privileged state fails closed: the list renders as it does for a
        // visitor, which is the same thing every signed-out reader sees.
      });

    return () => {
      active = false;
    };
  }, [brandId, loading, user]);

  const displayGroups = groupStockistsByRegion(allStockists);
  const ownerConfirmLabel = t("channels.ownerBanner.confirm");
  const ownerRejectLabel = t("channels.ownerBanner.reject");

  function setStockistError(stockistId: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[stockistId] = message;
      else delete next[stockistId];
      return next;
    });
  }

  function handleOwnerModeration(
    stockist: Stockist,
    status: "confirmed" | "rejected",
  ) {
    setStockistError(stockist.id, null);
    setPendingStockistId(stockist.id);

    startTransition(() => {
      void (async () => {
        try {
          const result = await ownerModerateStockistAction(
            stockist.id,
            brandSlug,
            status,
          );
          if ("error" in result) throw new Error(result.error);
        } catch (error) {
          setStockistError(stockist.id, getActionErrorMessage(error, tErrors));
        } finally {
          setPendingStockistId((current) =>
            current === stockist.id ? null : current,
          );
        }
      })();
    });
  }

  function rendersAsRow(stockist: Stockist) {
    if (stockist.status === "confirmed") return true;
    // The owner needs the moderation controls, which do not fit inside a chip.
    return isOwner;
  }

  function renderRow(stockist: Stockist) {
    return (
      <StockistListRow
        key={stockist.id}
        stockist={stockist}
        isPending={pendingStockistId === stockist.id}
        isOwner={isOwner}
        error={errors[stockist.id]}
        t={t}
        ownerConfirmLabel={ownerConfirmLabel}
        ownerRejectLabel={ownerRejectLabel}
        onModerate={handleOwnerModeration}
      />
    );
  }

  function renderRowStack(rows: Stockist[]) {
    if (rows.length === 0) return null;

    return <div className="divide-y divide-rule">{rows.map(renderRow)}</div>;
  }

  function renderChipStack(kind: string, chips: Stockist[]) {
    if (chips.length === 0) return null;

    const isExpanded = expandedChipGroups[kind] === true;
    const hiddenChipCount = Math.max(chips.length - MAX_VISIBLE_CHIPS, 0);
    const visibleChips = isExpanded ? chips : chips.slice(0, MAX_VISIBLE_CHIPS);

    return (
      <div className="space-y-3" data-stockist-chip-group={kind}>
        <ul className="flex flex-wrap gap-2">
          {visibleChips.map((stockist) => (
            <StockistChip key={stockist.id} stockist={stockist} t={t} />
          ))}
        </ul>
        {hiddenChipCount > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="compact"
            aria-expanded={isExpanded}
            onClick={() =>
              setExpandedChipGroups((current) => ({
                ...current,
                [kind]: !isExpanded,
              }))
            }
          >
            {t("channels.chips.showRest", { count: hiddenChipCount })}
          </Button>
        ) : null}
        {/* No live region here any more. It existed for the community confirm
            round-trip, which is gone: a chip is a static entry now, and the only
            message a stockist can still raise (owner moderation) belongs to the
            row that raised it. */}
      </div>
    );
  }

  function renderGroup(group: StockistRegionGroup) {
    const rowStockists = group.stockists.filter(rendersAsRow);
    const chipStockists = group.stockists.filter(
      (stockist) => !rendersAsRow(stockist),
    );
    const heading =
      group.key === "overseas" || group.key === "all_taiwan"
        ? t(`channels.groups.${group.key}`)
        : tCities(group.key);

    return (
      <details key={group.key} className="group" data-stockist-kind={group.key}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <h3 className="type-body-sm font-semibold text-ink">{`${heading} (${group.stockists.length})`}</h3>
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
          />
        </summary>
        <div className="space-y-4 pb-4">
          {renderChipStack(group.key, chipStockists)}
          {renderRowStack(rowStockists)}
        </div>
      </details>
    );
  }

  // Too few entries for grouping to earn headings: render one flat list.
  if (allStockists.length < GROUPED_LAYOUT_MIN_STOCKISTS) {
    const rowStockists = displayGroups.flatMap((group) =>
      group.stockists.filter(rendersAsRow),
    );
    const chipStockists = displayGroups.flatMap((group) =>
      group.stockists.filter((stockist) => !rendersAsRow(stockist)),
    );

    return (
      <div className="space-y-8" data-stockist-list>
        {renderChipStack("all_taiwan", chipStockists)}
        {renderRowStack(rowStockists)}
      </div>
    );
  }

  return (
    <div
      className="divide-y divide-rule border-y border-rule"
      data-stockist-list
    >
      {displayGroups.map(renderGroup)}
    </div>
  );
}
