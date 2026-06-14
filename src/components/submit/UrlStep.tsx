'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Link } from '@/i18n/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { FormPurchaseLink, SourceAttribution } from '@/lib/types/submission'
import type { ScrapedBrandData } from '@/lib/types/scraper'

type UrlStepStatus = 'idle' | 'loading' | 'error'

type ScrapeStatus = {
  ok: boolean
}

export type UrlStepLinks = {
  websiteUrl: string
  instagram: string
  threads: string
  facebook: string
  purchaseLinks: Array<{ platform: string; url: string }>
}

type UrlStepProps = {
  onSuccess: (data: ScrapedBrandData, links: UrlStepLinks) => void
  onSkip: (links: UrlStepLinks) => void
  isOwner: boolean
  onOwnerChange: (isOwner: boolean) => void
  onAttributionChange: (attribution: SourceAttribution | undefined) => void
}

const PLATFORM_OPTIONS = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'pchome', label: 'PChome' },
  { value: 'momo', label: 'Momo' },
  { value: 'pinkoi', label: 'Pinkoi' },
  { value: 'official', label: 'Official Site' },
  { value: 'other', label: 'Other' },
]

export function UrlStep({ onSuccess, onSkip, isOwner, onOwnerChange, onAttributionChange }: UrlStepProps) {
  const t = useTranslations('submit')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [instagram, setInstagram] = useState('')
  const [threads, setThreads] = useState('')
  const [facebook, setFacebook] = useState('')
  const [purchaseLinks, setPurchaseLinks] = useState<FormPurchaseLink[]>([
    { platform: '', url: '' },
  ])
  const [status, setStatus] = useState<UrlStepStatus>('idle')
  const [loadedBanner, setLoadedBanner] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isValidUrl = websiteUrl.trim().startsWith('https://')

  const stripParams = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) return trimmed
    try {
      const u = new URL(trimmed)
      u.search = ''
      return u.toString()
    } catch {
      return trimmed
    }
  }

  const getLinks = (): UrlStepLinks => ({
    websiteUrl: stripParams(websiteUrl),
    instagram,
    threads,
    facebook: stripParams(facebook),
    purchaseLinks: purchaseLinks.map((l) => ({
      ...l,
      url: stripParams(l.url),
    })),
  })

  const addPurchaseLink = () => {
    setPurchaseLinks((links) => [...links, { platform: '', url: '' }])
  }

  const removePurchaseLink = (index: number) => {
    setPurchaseLinks((links) => {
      if (links.length === 1) return links
      return links.filter((_, linkIndex) => linkIndex !== index)
    })
  }

  const updatePurchaseLink = (index: number, key: keyof FormPurchaseLink, value: string) => {
    setPurchaseLinks((links) =>
      links.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [key]: value } : link
      )
    )
  }

  const handleFetch = async () => {
    if (!isValidUrl) return

    setStatus('loading')
    setLoadedBanner(null)

    abortRef.current = new AbortController()

    const cleanUrl = stripParams(websiteUrl)

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [cleanUrl] }),
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        setStatus('error')
        return
      }

      const {
        data,
        statuses,
      }: { data: ScrapedBrandData; statuses?: ScrapeStatus[] } = await response.json()
      if (statuses?.some((sourceStatus) => !sourceStatus.ok)) {
        const loadedCount = statuses.filter((sourceStatus) => sourceStatus.ok).length
        setLoadedBanner(t('url.loadedStatus', { loaded: loadedCount, total: statuses.length }))
      }
      setStatus('idle')
      onSuccess(data, getLinks())
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle')
        return
      }
      setStatus('error')
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    setStatus('idle')
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h2 className="text-lg font-semibold text-foreground">
        {t('url.heading')}
      </h2>

      <div className="space-y-1.5">
        <label
          htmlFor="website-url"
          className="block text-sm font-semibold text-foreground"
        >
          {t('url.label')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('url.hint')}
        </p>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="website-url"
            type="url"
            placeholder="https://yourbrand.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            disabled={status === 'loading'}
            className="h-11 bg-background pl-10 pr-3 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('url.socialLinksLabel')}
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label htmlFor="url-instagram" className="w-28 shrink-0 text-sm text-muted-foreground">
              Instagram
            </label>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input
                id="url-instagram"
                type="text"
                placeholder="yourbrand"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value.replace(/^@/, ''))}
                disabled={status === 'loading'}
                className="h-11 bg-background pl-7 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="url-threads" className="w-28 shrink-0 text-sm text-muted-foreground">
              Threads
            </label>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input
                id="url-threads"
                type="text"
                placeholder="yourbrand"
                value={threads}
                onChange={(e) => setThreads(e.target.value.replace(/^@/, ''))}
                disabled={status === 'loading'}
                className="h-11 bg-background pl-7 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="url-facebook" className="w-28 shrink-0 text-sm text-muted-foreground">
              Facebook
            </label>
            <Input
              id="url-facebook"
              type="text"
              placeholder="https://facebook.com/yourbrand"
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              disabled={status === 'loading'}
              className="h-11 bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t('url.purchaseLinksLabel')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('url.purchaseLinksHint')}
          </p>
        </div>

        <div className="space-y-2">
          {purchaseLinks.map((link, index) => (
            <div key={index} className="flex items-start gap-2">
              <select
                role="combobox"
                value={link.platform}
                onChange={(e) => updatePurchaseLink(index, 'platform', e.target.value)}
                disabled={status === 'loading'}
                className="h-11 w-40 shrink-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{t('url.platformPlaceholder')}</option>
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Input
                type="url"
                placeholder="https://..."
                value={link.url}
                onChange={(e) => updatePurchaseLink(index, 'url', e.target.value)}
                disabled={status === 'loading'}
                className="h-11 bg-background focus-visible:ring-2 focus-visible:ring-ring"
              />
              {purchaseLinks.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('url.removeLink')}
                  onClick={() => removePurchaseLink(index)}
                  disabled={status === 'loading'}
                  className="h-11 w-11 shrink-0 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={addPurchaseLink}
          disabled={status === 'loading'}
          className="h-12 rounded-lg px-2 text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" />
          {t('url.addPurchaseLink')}
        </Button>
      </div>

      {!isOwner && (
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">
            {t('url.howKnowBrand')}
          </label>
          <Select onValueChange={(val) => onAttributionChange(val as SourceAttribution)}>
            <SelectTrigger
              aria-label={t('url.howKnowBrand')}
              className="h-11 w-full border-border text-sm text-foreground"
            >
              <SelectValue placeholder={t('url.howKnowPlaceholder')}>
                {(val) => (val ? t(`attribution.${val}`) : null)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SOURCE_ATTRIBUTION_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`attribution.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="is-brand-owner"
            checked={isOwner}
            onCheckedChange={(checked: boolean) => onOwnerChange(checked)}
          />
          <label
            htmlFor="is-brand-owner"
            className="cursor-pointer select-none text-sm font-medium text-foreground"
          >
            {t('url.isBrandOwner')}
          </label>
        </div>
        <p className="pl-6 text-xs text-muted-foreground">
          {t('url.ownerHint')}{' '}
          <Link href="/faq#claimBenefits" className="underline hover:text-foreground">
            {t('url.ownerLearnMore')}
          </Link>
        </p>
      </div>

      {status === 'error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">
            {t('url.fetchError')}
          </p>
        </div>
      )}

      {loadedBanner && (
        <div className="rounded-lg border border-border bg-muted p-3">
          <p className="text-sm text-muted-foreground">{loadedBanner}</p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        {status === 'loading' ? (
          <>
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('url.loading')}
            </div>
            <Button
              type="button"
              onClick={handleCancel}
              variant="ghost"
              className="h-12 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.cancel')}
            </Button>
          </>
        ) : status === 'error' ? (
          <>
            <Button
              type="button"
              onClick={handleFetch}
              className="focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.retry')}
            </Button>
            <Button
              type="button"
              onClick={() => onSkip(getLinks())}
              variant="ghost"
              className="h-12 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.manualFill')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={handleFetch}
            disabled={!isValidUrl}
            className="focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('url.autoFill')}
          </Button>
        )}
      </div>
    </div>
  )
}
