'use client'

import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import {
  Check,
  ChevronDown,
  ExternalLink,
  Monitor,
  Store,
  ThumbsUp,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import {
  confirmChannelAction,
  getChannelViewerStateAction,
  ownerModerateChannelAction,
} from '@/app/[locale]/brands/[slug]/actions'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { usePathname } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import {
  CHAIN_REGION_LABEL,
  groupChannelsByKind,
  type ChannelKind,
  type ChannelKindGroups,
} from '@/lib/brands/channels'
import type { BrandChannel } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAX_VISIBLE_CHIPS = 6
/** Below this count the grouping is noise — entries render without headings. */
const GROUPED_LAYOUT_MIN_CHANNELS = 4
/** Chain marker written by the enrichment phase; it carries no location worth repeating. */
const CHAIN_MARKER = CHAIN_REGION_LABEL
const ROW_KINDS: ReadonlySet<ChannelKind> = new Set<ChannelKind>([
  'official',
  'visitable',
])

type ChannelKindGroup = ChannelKindGroups[number]

type ViewerState = {
  isOwner: boolean
  confirmedChannelIds: string[]
}

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string

type ChannelActionContext = 'row' | 'chip'

export type BrandChannelListProps = {
  confirmed: BrandChannel[]
  possible: BrandChannel[]
  brandId: string
  brandSlug: string
  threshold: number
}

function getActionErrorMessage(
  error: unknown,
  translateError: (key: string) => string,
): string {
  if (error instanceof Error && error.message && error.message !== 'unknown') {
    try {
      return translateError(error.message)
    } catch {
      return error.message
    }
  }

  return translateError('unknown')
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
    )
  }

  return (
    <span
      aria-hidden="true"
      className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/60"
    />
  )
}

type ChannelRowProps = {
  channel: BrandChannel
  count: number
  threshold: number
  isViewerConfirmed: boolean
  isPending: boolean
  isOwner: boolean
  loading: boolean
  signInChannelId: string | null
  error: string | undefined
  t: Translate
  tNav: Translate
  signInHrefValue: string
  ownerConfirmLabel: string
  ownerRejectLabel: string
  onConfirm: (channel: BrandChannel, context: ChannelActionContext) => void
  onModerate: (channel: BrandChannel, status: 'confirmed' | 'rejected') => void
}

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
  const isOnline = channel.channelType === 'online'
  const Icon = isOnline ? Monitor : Store
  const region = channel.regionLabel ?? channel.address
  const mapsHref = channel.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(channel.address)}`
    : null
  const provenance =
    channel.confirmedBy ??
    (channel.ownerStatus === 'confirmed' ? 'owner' : 'community')
  const isConfirmed = channel.status === 'confirmed'

  return (
    <div
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
      data-channel-row
    >
      <div className="flex min-w-0 items-start gap-3">
        <StatusMarker confirmed={isConfirmed} />
        <div className="min-w-0">
          <p className="type-body-sm font-semibold">{channel.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Icon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
              data-channel-icon={isOnline ? 'monitor' : 'store'}
            />
            <span className="type-metadata">
              {t(
                isOnline
                  ? 'channels.dialog.channelTypeOnline'
                  : 'channels.dialog.channelTypeOffline',
              )}
            </span>
            {channel.categoryLabel ? (
              <Badge variant="secondary">{channel.categoryLabel}</Badge>
            ) : null}
          </div>
          {region ? (
            <div className="mt-2 type-body-sm">
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
            <p className="mt-2 rounded-lg border border-border bg-muted/50 p-3 type-card-description">
              <span>{t('channels.unconfirmed.signInToConfirm')}</span>{' '}
              <NextLink
                href={signInHrefValue}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {tNav('signIn')}
              </NextLink>
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 type-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {isConfirmed ? (
          <Badge variant="success">
            {t(`channels.provenance.${provenance}`)}
          </Badge>
        ) : (
          <span className="type-metadata whitespace-nowrap">
            {t('channels.unconfirmed.progress', { count, threshold })}
          </span>
        )}
        {channel.url ? (
          <a
            href={channel.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: 'secondary',
              size: 'compact',
              className: 'min-h-12',
            })}
          >
            {t(
              isOnline
                ? 'channels.confirmed.officialPageLink'
                : 'channels.confirmed.storeInfoLink',
            )}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
        {isConfirmed ? null : isOwner ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-pressed={channel.ownerStatus === 'confirmed'}
              disabled={isPending}
              onClick={() => onModerate(channel, 'confirmed')}
            >
              <Check aria-hidden="true" className="size-4" />
              {ownerConfirmLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              aria-pressed={channel.ownerStatus === 'rejected'}
              disabled={isPending}
              onClick={() => onModerate(channel, 'rejected')}
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {ownerRejectLabel}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant={isViewerConfirmed ? 'primary' : 'secondary'}
            size="compact"
            aria-pressed={isViewerConfirmed}
            disabled={loading || isViewerConfirmed || isPending}
            onClick={() => onConfirm(channel, 'row')}
          >
            {isViewerConfirmed ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <ThumbsUp aria-hidden="true" className="size-4" />
            )}
            {isViewerConfirmed
              ? t('channels.unconfirmed.confirmed')
              : t('channels.unconfirmed.confirmAction')}
          </Button>
        )}
      </div>
    </div>
  )
}

type ChannelChipProps = {
  channel: BrandChannel
  count: number
  threshold: number
  isViewerConfirmed: boolean
  isPending: boolean
  loading: boolean
  t: Translate
  onConfirm: (channel: BrandChannel, context: ChannelActionContext) => void
}

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
  const isOnline = channel.channelType === 'online'
  const isConfirmed = channel.status === 'confirmed'
  const region =
    channel.regionLabel && channel.regionLabel !== CHAIN_MARKER
      ? channel.regionLabel
      : null

  return (
    <li
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5',
        isConfirmed
          ? 'border-border bg-verified-green-bg text-verified-green'
          : 'border-dashed border-border',
      )}
      data-channel-chip
    >
      {isConfirmed ? (
        <Check aria-hidden="true" className="size-3.5 shrink-0" />
      ) : null}
      <span className="type-body-sm font-medium">{channel.name}</span>
      {region ? (
        <span className="type-metadata text-muted-foreground">({region})</span>
      ) : null}
      {channel.url ? (
        <a
          href={channel.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${channel.name} ${t(
            isOnline
              ? 'channels.confirmed.officialPageLink'
              : 'channels.confirmed.storeInfoLink',
          )}`}
          className="inline-flex min-h-8 min-w-8 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      ) : null}
      {isConfirmed ? null : (
        <>
          <span className="type-micro whitespace-nowrap">
            {t('channels.unconfirmed.progress', { count, threshold })}
          </span>
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            size="chip"
            // ::after grows the 32px control to a 44px touch target, as ui/switch does.
            className="relative px-2 after:absolute after:-inset-1.5 after:content-['']"
            aria-label={t('channels.chips.confirmAria', {
              name: channel.name,
            })}
            aria-pressed={isViewerConfirmed}
            disabled={loading || isViewerConfirmed || isPending}
            onClick={() => onConfirm(channel, 'chip')}
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
  )
}

export function BrandChannelList({
  confirmed,
  possible,
  brandId,
  brandSlug,
  threshold,
}: BrandChannelListProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('brandDetail')
  const tErrors = useTranslations('brandDetail.channels.errors')
  const tNav = useTranslations('nav')
  const { user, loading } = useUser()
  const [, startTransition] = useTransition()
  const allChannels = [...confirmed, ...possible]
  const [expandedChipGroups, setExpandedChipGroups] = useState<
    Partial<Record<ChannelKind, boolean>>
  >({})
  const [viewerState, setViewerState] = useState<ViewerState>({
    isOwner: false,
    confirmedChannelIds: allChannels
      .filter((channel) => channel.hasCurrentUserConfirmed)
      .map((channel) => channel.id),
  })
  const [confirmationCounts, setConfirmationCounts] = useState<
    Record<string, number>
  >(() =>
    Object.fromEntries(
      allChannels.map((channel) => [channel.id, channel.confirmationCount]),
    ),
  )
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null)
  const [signInChannelId, setSignInChannelId] = useState<string | null>(null)
  const [lastChipAttemptedChannelId, setLastChipAttemptedChannelId] = useState<
    string | null
  >(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (loading || !user) return

    let active = true
    void getChannelViewerStateAction(brandId)
      .then((nextViewerState) => {
        if (!active) return
        setViewerState(nextViewerState)
      })
      .catch(() => {
        // Privileged state fails closed; the community controls remain available.
      })

    return () => {
      active = false
    }
  }, [brandId, loading, user])

  const groups = groupChannelsByKind(allChannels)
  const signInHrefValue = signInHref(pathname, locale)
  const ownerConfirmLabel = t('channels.ownerBanner.confirm')
  const ownerRejectLabel = t('channels.ownerBanner.reject')

  function setChannelError(channelId: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current }
      if (message) next[channelId] = message
      else delete next[channelId]
      return next
    })
  }

  function setChannelConfirmed(channelId: string, isConfirmed: boolean) {
    setViewerState((current) => {
      const confirmedChannelIds = new Set(current.confirmedChannelIds)
      if (isConfirmed) confirmedChannelIds.add(channelId)
      else confirmedChannelIds.delete(channelId)
      return {
        ...current,
        confirmedChannelIds: Array.from(confirmedChannelIds),
      }
    })
  }

  function handleConfirm(channel: BrandChannel, context: ChannelActionContext) {
    if (loading) return
    if (context === 'chip') setLastChipAttemptedChannelId(channel.id)

    if (!user) {
      setSignInChannelId(channel.id)
      return
    }

    const previousCount =
      confirmationCounts[channel.id] ?? channel.confirmationCount
    setSignInChannelId(null)
    setChannelError(channel.id, null)
    setConfirmationCounts((current) => ({
      ...current,
      [channel.id]: previousCount + 1,
    }))
    setChannelConfirmed(channel.id, true)
    setPendingChannelId(channel.id)

    startTransition(() => {
      void (async () => {
        try {
          const result = await confirmChannelAction(channel.id, brandSlug)
          if ('error' in result) throw new Error(result.error)

          setConfirmationCounts((current) => ({
            ...current,
            [channel.id]: result.confirmationCount,
          }))
        } catch (error) {
          setConfirmationCounts((current) => ({
            ...current,
            [channel.id]: previousCount,
          }))
          setChannelConfirmed(channel.id, false)
          setChannelError(channel.id, getActionErrorMessage(error, tErrors))
        } finally {
          setPendingChannelId((current) =>
            current === channel.id ? null : current,
          )
        }
      })()
    })
  }

  function handleOwnerModeration(
    channel: BrandChannel,
    status: 'confirmed' | 'rejected',
  ) {
    setChannelError(channel.id, null)
    setPendingChannelId(channel.id)

    startTransition(() => {
      void (async () => {
        try {
          const result = await ownerModerateChannelAction(
            channel.id,
            brandSlug,
            status,
          )
          if ('error' in result) throw new Error(result.error)
        } catch (error) {
          setChannelError(channel.id, getActionErrorMessage(error, tErrors))
        } finally {
          setPendingChannelId((current) =>
            current === channel.id ? null : current,
          )
        }
      })()
    })
  }

  function rendersAsRow(kind: ChannelKind, channel: BrandChannel) {
    if (ROW_KINDS.has(kind)) return true
    // The owner needs the moderation controls, which do not fit inside a chip.
    return viewerState.isOwner && channel.status !== 'confirmed'
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
    )
  }

  function renderRowStack(rows: BrandChannel[]) {
    if (rows.length === 0) return null

    const confirmedRows = rows.filter(
      (channel) => channel.status === 'confirmed',
    )
    const unconfirmedRows = rows.filter(
      (channel) => channel.status !== 'confirmed',
    )

    return (
      <div className="space-y-4">
        {confirmedRows.length > 0 ? (
          <div className="divide-y divide-border">
            {confirmedRows.map(renderRow)}
          </div>
        ) : null}
        {unconfirmedRows.length > 0 ? (
          <details
            className="group rounded-lg border border-border px-4"
            open={confirmed.length === 0}
          >
            <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-3 type-body-sm [&::-webkit-details-marker]:hidden">
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
              />
              <span>
                {t('channels.unconfirmed.foldSummary', {
                  count: unconfirmedRows.length,
                })}
              </span>
              <Badge variant="secondary" className="h-auto whitespace-normal">
                {t('channels.unconfirmed.thresholdNote', { threshold })}
              </Badge>
            </summary>
            <div className="divide-y divide-border pb-2">
              {unconfirmedRows.map(renderRow)}
            </div>
          </details>
        ) : null}
      </div>
    )
  }

  function renderChipStack(kind: ChannelKind, chips: BrandChannel[]) {
    if (chips.length === 0) return null

    const isExpanded = expandedChipGroups[kind] === true
    const hiddenChipCount = Math.max(chips.length - MAX_VISIBLE_CHIPS, 0)
    const visibleChips = isExpanded ? chips : chips.slice(0, MAX_VISIBLE_CHIPS)
    const attemptedChannel = chips.find(
      (channel) => channel.id === lastChipAttemptedChannelId,
    )
    const attemptedError = attemptedChannel
      ? errors[attemptedChannel.id]
      : undefined
    const showsSignInPrompt =
      attemptedChannel !== undefined &&
      signInChannelId === attemptedChannel.id

    return (
      <div className="space-y-3" data-channel-chip-group={kind}>
        <ul className="flex flex-wrap gap-2">
          {visibleChips.map((channel) => (
            <ChannelChip
              key={channel.id}
              channel={channel}
              count={confirmationCounts[channel.id] ?? channel.confirmationCount}
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
            {t('channels.chips.showRest', { count: hiddenChipCount })}
          </Button>
        ) : null}
        {/* One live region per chip group — a chip is too small to host its own message. */}
        <div role="status" data-channel-chip-status>
          {attemptedChannel && showsSignInPrompt ? (
            <p className="rounded-lg border border-border bg-muted/50 p-3 type-card-description">
              <span className="font-medium">{attemptedChannel.name}</span>{' '}
              <span>{t('channels.unconfirmed.signInToConfirm')}</span>{' '}
              <NextLink
                href={signInHrefValue}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {tNav('signIn')}
              </NextLink>
            </p>
          ) : null}
          {attemptedChannel && !showsSignInPrompt && attemptedError ? (
            <p className="type-error" role="alert">
              <span className="font-medium">{attemptedChannel.name}</span>{' '}
              <span>{attemptedError}</span>
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  function renderGroup(group: ChannelKindGroup) {
    const rowChannels = group.channels.filter((channel) =>
      rendersAsRow(group.key, channel),
    )
    const chipChannels = group.channels.filter(
      (channel) => !rendersAsRow(group.key, channel),
    )

    return (
      <section
        key={group.key}
        className="space-y-4"
        data-channel-kind={group.key}
      >
        <h3 className="type-subsection-title">
          {`${t(`channels.groups.${group.key}`)} (${group.channels.length})`}
        </h3>
        {group.key === 'chain' ? (
          <p className="type-card-description text-muted-foreground">
            {t('channels.groups.chainNote')}
          </p>
        ) : null}
        {renderChipStack(group.key, chipChannels)}
        {renderRowStack(rowChannels)}
      </section>
    )
  }

  // Too few entries for grouping to earn its headings: one flat list of rows.
  if (allChannels.length < GROUPED_LAYOUT_MIN_CHANNELS) {
    return (
      <div className="space-y-8" data-brand-channel-list>
        {renderRowStack(groups.flatMap((group) => group.channels))}
      </div>
    )
  }

  return (
    <div className="space-y-8" data-brand-channel-list>
      <div className="flex flex-wrap gap-x-4 gap-y-1 type-metadata">
        {groups.map((group) => (
          <span key={group.key}>
            {`${t(`channels.groups.${group.key}`)} · ${group.channels.length}`}
          </span>
        ))}
      </div>
      <div className="space-y-8">
        {groups.map(renderGroup)}
      </div>
    </div>
  )
}
