"use client";

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ExternalLink,
  Heart,
  MapPin,
  Monitor,
  Store,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  confirmChannelAction,
  getChannelViewerStateAction,
  ownerModerateChannelAction,
} from "@/app/[locale]/brands/[slug]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";
import { usePathname } from "@/i18n/navigation";
import { signInHref } from "@/i18n/locale-preference";
import { useUser } from "@/lib/auth/use-user";
import type { BrandChannel } from "@/lib/types";

const INITIAL_VISIBLE_CHANNELS = 8;

export type UnconfirmedChannelGridProps = {
  channels: BrandChannel[];
  brandId: string;
  brandSlug: string;
};

type ViewerState = {
  isOwner: boolean;
  confirmedChannelIds: string[];
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

export function UnconfirmedChannelGrid({
  channels,
  brandId,
  brandSlug,
}: UnconfirmedChannelGridProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("brandDetail");
  const tErrors = useTranslations("brandDetail.channels.errors");
  const tNav = useTranslations("nav");
  const { user, loading } = useUser();
  const [, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerState>({
    isOwner: false,
    confirmedChannelIds: channels
      .filter((channel) => channel.hasCurrentUserConfirmed)
      .map((channel) => channel.id),
  });
  const [confirmationCounts, setConfirmationCounts] = useState<
    Record<string, number>
  >(() =>
    Object.fromEntries(
      channels.map((channel) => [channel.id, channel.confirmationCount]),
    ),
  );
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [signInChannelId, setSignInChannelId] = useState<string | null>(null);
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

  const visibleChannels = showAll
    ? channels
    : channels.slice(0, INITIAL_VISIBLE_CHANNELS);
  const hiddenChannelCount = Math.max(
    channels.length - INITIAL_VISIBLE_CHANNELS,
    0,
  );
  const ownerConfirmLabel = locale === "en" ? "Confirm sold here" : "確認販售";
  const ownerRejectLabel = locale === "en" ? "Not sold here" : "未販售";

  function setChannelError(channelId: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[channelId] = message;
      else delete next[channelId];
      return next;
    });
  }

  function setChannelConfirmed(channelId: string, confirmed: boolean) {
    setViewerState((current) => {
      const confirmedChannelIds = new Set(current.confirmedChannelIds);
      if (confirmed) confirmedChannelIds.add(channelId);
      else confirmedChannelIds.delete(channelId);
      return {
        ...current,
        confirmedChannelIds: Array.from(confirmedChannelIds),
      };
    });
  }

  function handleConfirm(channel: BrandChannel) {
    if (loading) return;
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

  return (
    <div className="space-y-4" data-channel-grid>
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleChannels.map((channel) => {
          const isOnline = channel.channelType === "online";
          const Icon = isOnline ? Monitor : Store;
          const isConfirmed = viewerState.confirmedChannelIds.includes(
            channel.id,
          );
          const isPendingChannel = pendingChannelId === channel.id;
          const count =
            confirmationCounts[channel.id] ?? channel.confirmationCount;
          const region = channel.regionLabel ?? channel.address;
          const mapsHref = channel.address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(channel.address)}`
            : null;

          return (
            <SurfaceCard
              key={channel.id}
              padding="sm"
              className="flex h-full flex-col gap-4"
              data-testid="channel-card"
            >
              <div className="flex items-start gap-3">
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <h4 className="type-subsection-title">{channel.name}</h4>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="type-metadata">
                      {t(
                        isOnline
                          ? "channels.dialog.channelTypeOnline"
                          : "channels.dialog.channelTypeOffline",
                      )}
                    </span>
                    {channel.categoryLabel ? (
                      <Badge variant="secondary">{channel.categoryLabel}</Badge>
                    ) : null}
                  </div>
                  {region ? (
                    <div className="mt-2 flex items-center gap-1.5 type-body-sm">
                      <MapPin
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      {mapsHref ? (
                        <a
                          href={mapsHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate underline underline-offset-4"
                        >
                          {region}
                        </a>
                      ) : (
                        <span className="truncate">{region}</span>
                      )}
                    </div>
                  ) : null}
                  {channel.url ? (
                    <a
                      href={channel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-12 items-center gap-1.5 type-body-sm underline underline-offset-4"
                    >
                      {t(
                        isOnline
                          ? "channels.confirmed.officialPageLink"
                          : "channels.confirmed.storeInfoLink",
                      )}
                      <ExternalLink aria-hidden="true" className="size-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="mt-auto space-y-3">
                <div className="flex items-center gap-1.5 type-card-description">
                  <Heart aria-hidden="true" className="size-4" />
                  <span>
                    {t("channels.unconfirmed.confirmedCount", { count })}
                  </span>
                </div>

                {viewerState.isOwner ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="compact"
                      aria-pressed={channel.ownerStatus === "confirmed"}
                      disabled={isPendingChannel}
                      onClick={() =>
                        handleOwnerModeration(channel, "confirmed")
                      }
                    >
                      <Check aria-hidden="true" className="size-4" />
                      {ownerConfirmLabel}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="compact"
                      aria-pressed={channel.ownerStatus === "rejected"}
                      disabled={isPendingChannel}
                      onClick={() => handleOwnerModeration(channel, "rejected")}
                    >
                      <TriangleAlert aria-hidden="true" className="size-4" />
                      {ownerRejectLabel}
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant={isConfirmed ? "primary" : "secondary"}
                    size="compact"
                    aria-pressed={isConfirmed}
                    disabled={loading || isConfirmed || isPendingChannel}
                    onClick={() => handleConfirm(channel)}
                  >
                    {isConfirmed ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : (
                      <ThumbsUp aria-hidden="true" className="size-4" />
                    )}
                    {isConfirmed
                      ? t("channels.unconfirmed.confirmed")
                      : t("channels.unconfirmed.confirmAction")}
                  </Button>
                )}

                {signInChannelId === channel.id ? (
                  <p className="rounded-lg border border-border bg-muted/50 p-3 type-card-description">
                    {t("channels.unconfirmed.signInToConfirm")}{" "}
                    <NextLink
                      href={signInHref(pathname, locale)}
                      className="font-medium text-foreground underline underline-offset-4"
                    >
                      {tNav("signIn")}
                    </NextLink>
                  </p>
                ) : null}

                {errors[channel.id] ? (
                  <p className="type-error" role="alert">
                    {errors[channel.id]}
                  </p>
                ) : null}
              </div>
            </SurfaceCard>
          );
        })}
      </div>

      {hiddenChannelCount > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll
            ? t("channels.unconfirmed.showLess")
            : `${t("channels.unconfirmed.showAll")} (${hiddenChannelCount})`}
        </Button>
      ) : null}
    </div>
  );
}
