"use client";

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  ExternalLink,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  confirmChannelAction,
  getChannelViewerStateAction,
  ownerModerateChannelAction,
} from "@/app/[locale]/(site)/brands/[slug]/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { usePathname } from "@/i18n/navigation";
import { signInHref } from "@/i18n/locale-preference";
import { useUser } from "@/lib/auth/use-user";
import {
  CHAIN_REGION_LABEL,
  groupChannelsByRegion,
  type ChannelRegionGroup,
} from "@/lib/brands/channels";
import type { BrandChannel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBrandEngagement } from "./brand-engagement-tracker";

const MAX_VISIBLE_CHIPS = 6;
/** Below this count the grouping is noise — entries render without headings. */
const GROUPED_LAYOUT_MIN_CHANNELS = 4;
/** Chain marker written by the enrichment phase; it carries no location worth repeating. */
const CHAIN_MARKER = CHAIN_REGION_LABEL;
type ViewerState = {
  isOwner: boolean;
  confirmedChannelIds: string[];
};

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type ChannelActionContext = "row" | "chip";

export type BrandChannelListProps = {
  confirmed: BrandChannel[];
  possible: BrandChannel[];
  brandId: string;
  brandSlug: string;
  threshold: number;
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
      className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/60"
    />
  );
}

type ChannelRowProps = {
  channel: BrandChannel;
  count: number;
  threshold: number;
  isViewerConfirmed: boolean;
  isPending: boolean;
  isOwner: boolean;
  loading: boolean;
  signInChannelId: string | null;
  error: string | undefined;
  t: Translate;
  tNav: Translate;
  signInHrefValue: string;
  ownerConfirmLabel: string;
  ownerRejectLabel: string;
  onConfirm: (channel: BrandChannel, context: ChannelActionContext) => void;
  onModerate: (channel: BrandChannel, status: "confirmed" | "rejected") => void;
};

function ChannelRow({
  channel,
  count,
  threshold,
  isViewerConfirmed,
  isPending,
  isOwner,
  loading,
  signInChannelId,
  error,
  t,
  tNav,
  signInHrefValue,
  ownerConfirmLabel,
  ownerRejectLabel,
  onConfirm,
  onModerate,
}: ChannelRowProps) {
  const isOnline = channel.channelType === "online";
  // An ONLINE channel has no location, so it must never print one. Some rows
  // carry a region_label and even a street address anyway (a head-office
  // address on a webshop row), and printing it filed an online entry under a
  // city in the reader's mind. The online group heading is the only location
  // an online channel has.
  const region = isOnline ? null : (channel.address ?? channel.regionLabel);
  const mapsHref = channel.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(channel.address)}`
    : null;
  // Only a rendered Maps link counts as a way through: an online row with a
  // head-office address builds a mapsHref it never prints.
  const showsMapsLink = region !== null && mapsHref !== null;
  // The href itself rather than a boolean beside it: `channel.url` is
  // `string | null`, and a separate flag proves nothing to the compiler at the
  // point of use — the anchor below needs the narrowing, not the answer.
  const outboundHref = showsMapsLink ? null : channel.url;
  const provenance =
    channel.confirmedBy ??
    (channel.ownerStatus === "confirmed" ? "owner" : "community");
  const provenanceKey =
    provenance === "evidence" && channel.evidenceSource !== "official_website"
      ? "evidenceOther"
      : provenance;
  const isConfirmed = channel.status === "confirmed";

  return (
    <div
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
      data-channel-row
      // The optimistic count and pressed state land before the server action is
      // even dispatched, so they cannot tell "saving" from "saved". This is the
      // only signal that the round-trip has settled.
      data-confirm-pending={isPending ? "" : undefined}
    >
      <div className="flex min-w-0 items-start gap-3">
        <StatusMarker confirmed={isConfirmed} />
        <div className="min-w-0">
          <p className="type-body-sm font-medium text-ink">{channel.name}</p>
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
          {signInChannelId === channel.id ? (
            <p className="mt-2 rounded-lg border border-border bg-muted/50 p-3 type-body-sm">
              <span>{t("channels.unconfirmed.signInToConfirm")}</span>{" "}
              <NextLink
                href={signInHrefValue}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {tNav("signIn")}
              </NextLink>
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 type-metadata text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {isConfirmed ? (
          <Badge variant="success">
            {t(`channels.provenance.${provenanceKey}`)}
          </Badge>
        ) : (
          <span className="type-metadata whitespace-nowrap">
            {t("channels.unconfirmed.progress", { count, threshold })}
          </span>
        )}
        {/* Exactly one way through per channel. When the address renders as a
            Google Maps link that IS the way through, so the outbound button
            would send the reader to a second page saying the same thing. When
            there is no rendered address — every online row, and an offline row
            whose address is unknown — the outbound link is the only way
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
        {isConfirmed ? null : isOwner ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-pressed={channel.ownerStatus === "confirmed"}
              disabled={isPending}
              onClick={() => onModerate(channel, "confirmed")}
            >
              <Check aria-hidden="true" className="size-4" />
              {ownerConfirmLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-pressed={channel.ownerStatus === "rejected"}
              disabled={isPending}
              onClick={() => onModerate(channel, "rejected")}
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {ownerRejectLabel}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant={isViewerConfirmed ? "primary" : "secondary"}
            size="compact"
            aria-pressed={isViewerConfirmed}
            aria-busy={isPending}
            disabled={loading || isViewerConfirmed || isPending}
            onClick={() => onConfirm(channel, "row")}
          >
            {isViewerConfirmed ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <ThumbsUp aria-hidden="true" className="size-4" />
            )}
            {isViewerConfirmed
              ? t("channels.unconfirmed.confirmed")
              : t("channels.unconfirmed.confirmAction")}
          </Button>
        )}
      </div>
    </div>
  );
}

type ChannelChipProps = {
  channel: BrandChannel;
  count: number;
  threshold: number;
  isViewerConfirmed: boolean;
  isPending: boolean;
  loading: boolean;
  t: Translate;
  onConfirm: (channel: BrandChannel, context: ChannelActionContext) => void;
};

function ChannelChip({
  channel,
  count,
  threshold,
  isViewerConfirmed,
  isPending,
  loading,
  t,
  onConfirm,
}: ChannelChipProps) {
  const isOnline = channel.channelType === "online";
  const isConfirmed = channel.status === "confirmed";
  // Same rule as the row: an online channel prints no location. This is what
  // printed a city in parentheses beside an official-website chip.
  const region =
    !isOnline && channel.regionLabel && channel.regionLabel !== CHAIN_MARKER
      ? channel.regionLabel
      : null;
  const mapsHref = channel.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(channel.address)}`
    : null;
  // Same rule as the row: the outbound icon is a fallback, not a duplicate.
  const showsMapsLink = region !== null && mapsHref !== null;
  // Held as the href, not as a boolean — see the row above.
  const outboundHref = showsMapsLink ? null : channel.url;

  return (
    <li
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5",
        isConfirmed
          ? "border-border bg-verified-green-bg text-verified-green"
          : "border-dashed border-border",
      )}
      data-channel-chip
      data-confirm-pending={isPending ? "" : undefined}
    >
      {isConfirmed ? (
        <Check aria-hidden="true" className="size-3.5 shrink-0" />
      ) : null}
      <span className="type-body-sm font-medium text-ink">{channel.name}</span>
      {region ? (
        <span className="type-metadata text-muted-foreground">
          (
          {mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {region}
            </a>
          ) : (
            region
          )}
          )
        </span>
      ) : null}
      {/* A physical location with a printed region reaches its destination
          through the Maps link above, so the icon would duplicate it. Without
          that link — an online chip, or a chip whose region is the chain
          sentinel or unknown — this icon is the only way through. */}
      {outboundHref !== null ? (
        <a
          href={outboundHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${channel.name} ${t("channels.confirmed.officialPageLink")}`}
          className="inline-flex min-h-8 min-w-8 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      ) : null}
      {isConfirmed ? null : (
        <>
          <span className="type-micro whitespace-nowrap">
            {t("channels.unconfirmed.progress", { count, threshold })}
          </span>
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            size="chip"
            // ::after grows the 32px control to a 44px touch target, as ui/switch does.
            className="relative px-2 after:absolute after:-inset-1.5 after:content-['']"
            aria-label={t("channels.chips.confirmAria", {
              name: channel.name,
            })}
            aria-pressed={isViewerConfirmed}
            aria-busy={isPending}
            disabled={loading || isViewerConfirmed || isPending}
            onClick={() => onConfirm(channel, "chip")}
          >
            {isViewerConfirmed ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : (
              <ThumbsUp aria-hidden="true" className="size-3.5" />
            )}
          </Button>
        </>
      )}
    </li>
  );
}

export function BrandChannelList({
  confirmed,
  possible,
  brandId,
  brandSlug,
  threshold,
}: BrandChannelListProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("brandDetail");
  const tErrors = useTranslations("brandDetail.channels.errors");
  const tNav = useTranslations("nav");
  const tCities = useTranslations("cities");
  const { user, loading } = useUser();
  const { reportEngagement } = useBrandEngagement();
  const [, startTransition] = useTransition();
  const allChannels = [...confirmed, ...possible];
  const [expandedChipGroups, setExpandedChipGroups] = useState<
    Partial<Record<string, boolean>>
  >({});
  const [viewerState, setViewerState] = useState<ViewerState>({
    isOwner: false,
    confirmedChannelIds: allChannels
      .filter((channel) => channel.hasCurrentUserConfirmed)
      .map((channel) => channel.id),
  });
  const [confirmationCounts, setConfirmationCounts] = useState<
    Record<string, number>
  >(() =>
    Object.fromEntries(
      allChannels.map((channel) => [channel.id, channel.confirmationCount]),
    ),
  );
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [signInChannelId, setSignInChannelId] = useState<string | null>(null);
  const [lastChipAttemptedChannelId, setLastChipAttemptedChannelId] = useState<
    string | null
  >(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (loading || !user) return;

    let active = true;
    void getChannelViewerStateAction(brandId)
      .then((nextViewerState) => {
        if (!active) return;
        setViewerState(nextViewerState);
      })
      .catch(() => {
        // Privileged state fails closed; the community controls remain available.
      });

    return () => {
      active = false;
    };
  }, [brandId, loading, user]);

  const displayGroups = groupChannelsByRegion(allChannels);
  const signInHrefValue = signInHref(pathname, locale);
  const ownerConfirmLabel = t("channels.ownerBanner.confirm");
  const ownerRejectLabel = t("channels.ownerBanner.reject");

  function setChannelError(channelId: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[channelId] = message;
      else delete next[channelId];
      return next;
    });
  }

  function setChannelConfirmed(channelId: string, isConfirmed: boolean) {
    setViewerState((current) => {
      const confirmedChannelIds = new Set(current.confirmedChannelIds);
      if (isConfirmed) confirmedChannelIds.add(channelId);
      else confirmedChannelIds.delete(channelId);
      return {
        ...current,
        confirmedChannelIds: Array.from(confirmedChannelIds),
      };
    });
  }

  function handleConfirm(channel: BrandChannel, context: ChannelActionContext) {
    if (loading) return;
    reportEngagement("channel");
    if (context === "chip") setLastChipAttemptedChannelId(channel.id);

    if (!user) {
      setSignInChannelId(channel.id);
      return;
    }

    const previousCount =
      confirmationCounts[channel.id] ?? channel.confirmationCount;
    setSignInChannelId(null);
    setChannelError(channel.id, null);
    setConfirmationCounts((current) => ({
      ...current,
      [channel.id]: previousCount + 1,
    }));
    setChannelConfirmed(channel.id, true);
    setPendingChannelId(channel.id);

    startTransition(() => {
      void (async () => {
        try {
          const result = await confirmChannelAction(channel.id, brandSlug);
          if ("error" in result) throw new Error(result.error);

          setConfirmationCounts((current) => ({
            ...current,
            [channel.id]: result.confirmationCount,
          }));
        } catch (error) {
          setConfirmationCounts((current) => ({
            ...current,
            [channel.id]: previousCount,
          }));
          setChannelConfirmed(channel.id, false);
          setChannelError(channel.id, getActionErrorMessage(error, tErrors));
        } finally {
          setPendingChannelId((current) =>
            current === channel.id ? null : current,
          );
        }
      })();
    });
  }

  function handleOwnerModeration(
    channel: BrandChannel,
    status: "confirmed" | "rejected",
  ) {
    setChannelError(channel.id, null);
    setPendingChannelId(channel.id);

    startTransition(() => {
      void (async () => {
        try {
          const result = await ownerModerateChannelAction(
            channel.id,
            brandSlug,
            status,
          );
          if ("error" in result) throw new Error(result.error);
        } catch (error) {
          setChannelError(channel.id, getActionErrorMessage(error, tErrors));
        } finally {
          setPendingChannelId((current) =>
            current === channel.id ? null : current,
          );
        }
      })();
    });
  }

  function rendersAsRow(channel: BrandChannel) {
    if (channel.status === "confirmed") return true;
    // The owner needs the moderation controls, which do not fit inside a chip.
    return viewerState.isOwner;
  }

  function renderRow(channel: BrandChannel) {
    return (
      <ChannelRow
        key={channel.id}
        channel={channel}
        count={confirmationCounts[channel.id] ?? channel.confirmationCount}
        threshold={threshold}
        isViewerConfirmed={viewerState.confirmedChannelIds.includes(channel.id)}
        isPending={pendingChannelId === channel.id}
        isOwner={viewerState.isOwner}
        loading={loading}
        signInChannelId={signInChannelId}
        error={errors[channel.id]}
        t={t}
        tNav={tNav}
        signInHrefValue={signInHrefValue}
        ownerConfirmLabel={ownerConfirmLabel}
        ownerRejectLabel={ownerRejectLabel}
        onConfirm={handleConfirm}
        onModerate={handleOwnerModeration}
      />
    );
  }

  function renderRowStack(rows: BrandChannel[]) {
    if (rows.length === 0) return null;

    return <div className="divide-y divide-border">{rows.map(renderRow)}</div>;
  }

  function renderChipStack(kind: string, chips: BrandChannel[]) {
    if (chips.length === 0) return null;

    const isExpanded = expandedChipGroups[kind] === true;
    const hiddenChipCount = Math.max(chips.length - MAX_VISIBLE_CHIPS, 0);
    const visibleChips = isExpanded ? chips : chips.slice(0, MAX_VISIBLE_CHIPS);
    const attemptedChannel = chips.find(
      (channel) => channel.id === lastChipAttemptedChannelId,
    );
    const attemptedError = attemptedChannel
      ? errors[attemptedChannel.id]
      : undefined;
    const showsSignInPrompt =
      attemptedChannel !== undefined && signInChannelId === attemptedChannel.id;

    return (
      <div className="space-y-3" data-channel-chip-group={kind}>
        <ul className="flex flex-wrap gap-2">
          {visibleChips.map((channel) => (
            <ChannelChip
              key={channel.id}
              channel={channel}
              count={
                confirmationCounts[channel.id] ?? channel.confirmationCount
              }
              threshold={threshold}
              isViewerConfirmed={viewerState.confirmedChannelIds.includes(
                channel.id,
              )}
              isPending={pendingChannelId === channel.id}
              loading={loading}
              t={t}
              onConfirm={handleConfirm}
            />
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
        {/* One live region per chip group — a chip is too small to host its own message. */}
        <div role="status" data-channel-chip-status>
          {attemptedChannel && showsSignInPrompt ? (
            <p className="rounded-lg border border-border bg-muted/50 p-3 type-body-sm">
              <span className="font-medium">{attemptedChannel.name}</span>{" "}
              <span>{t("channels.unconfirmed.signInToConfirm")}</span>{" "}
              <NextLink
                href={signInHrefValue}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {tNav("signIn")}
              </NextLink>
            </p>
          ) : null}
          {attemptedChannel && !showsSignInPrompt && attemptedError ? (
            <p className="type-metadata text-danger" role="alert">
              <span className="font-medium">{attemptedChannel.name}</span>{" "}
              <span>{attemptedError}</span>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  function renderGroup(group: ChannelRegionGroup) {
    const rowChannels = group.channels.filter(rendersAsRow);
    const chipChannels = group.channels.filter(
      (channel) => !rendersAsRow(channel),
    );
    const heading =
      group.key === "online" ||
      group.key === "overseas" ||
      group.key === "all_taiwan"
        ? t(`channels.groups.${group.key}`)
        : tCities(group.key);

    return (
      <details key={group.key} className="group" data-channel-kind={group.key}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <h3 className="type-body-sm font-semibold text-ink">{`${heading} (${group.channels.length})`}</h3>
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          />
        </summary>
        <div className="space-y-4 pb-4">
          {renderChipStack(group.key, chipChannels)}
          {renderRowStack(rowChannels)}
        </div>
      </details>
    );
  }

  // Too few entries for grouping to earn headings: render one flat list.
  if (allChannels.length < GROUPED_LAYOUT_MIN_CHANNELS) {
    const rowChannels = displayGroups.flatMap((group) =>
      group.channels.filter(rendersAsRow),
    );
    const chipChannels = displayGroups.flatMap((group) =>
      group.channels.filter((channel) => !rendersAsRow(channel)),
    );

    return (
      <div className="space-y-8" data-brand-channel-list>
        {renderChipStack("all_taiwan", chipChannels)}
        {renderRowStack(rowChannels)}
      </div>
    );
  }

  return (
    <div
      className="divide-y divide-border border-y border-border"
      data-brand-channel-list
    >
      {displayGroups.map(renderGroup)}
    </div>
  );
}
