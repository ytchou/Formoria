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
import type { SourceAttribution } from '@/lib/types/submission'
import type { OtherUrl } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'

type UrlStepStatus = 'idle' | 'loading' | 'error'

type ScrapeStatus = {
  ok: boolean
}

export type UrlStepLinks = {
  websiteUrl: string
  socialInstagram: string
  socialThreads: string
  socialFacebook: string
  purchaseWebsite: string
  purchasePinkoi: string
  purchaseShopee: string
  otherUrls: OtherUrl[]
  // Compatibility for SubmitWizard until the full submission form migrates.
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

const MAX_OTHER_LINKS = 3

const isUrlLike = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return true
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function UrlStep({ onSuccess, onSkip, isOwner, onOwnerChange, onAttributionChange }: UrlStepProps) {
  const t = useTranslations('submit')
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [socialInstagram, setSocialInstagram] = useState('')
  const [socialThreads, setSocialThreads] = useState('')
  const [socialFacebook, setSocialFacebook] = useState('')
  const [purchaseWebsite, setPurchaseWebsite] = useState('')
  const [purchasePinkoi, setPurchasePinkoi] = useState('')
  const [purchaseShopee, setPurchaseShopee] = useState('')
  const [otherUrls, setOtherUrls] = useState<OtherUrl[]>([])
  const [urlErrors, setUrlErrors] = useState<Record<string, boolean>>({})
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

  const stripHandle = (value: string) => value.trim().replace(/^@+/, '')

  const validateUrlField = (field: string, value: string) => {
    setUrlErrors((errors) => ({
      ...errors,
      [field]: !isUrlLike(value),
    }))
  }

  const buildPurchaseLinks = () => [
    ...(purchaseWebsite.trim() ? [{ platform: 'official', url: stripParams(purchaseWebsite) }] : []),
    ...(purchasePinkoi.trim() ? [{ platform: 'pinkoi', url: stripParams(purchasePinkoi) }] : []),
    ...(purchaseShopee.trim() ? [{ platform: 'shopee', url: stripParams(purchaseShopee) }] : []),
    ...otherUrls
      .filter((link) => link.label.trim() || link.url.trim())
      .map((link) => ({ platform: link.label.trim() || 'other', url: stripParams(link.url) })),
  ]

  const getLinks = (): UrlStepLinks => {
    const cleanWebsiteUrl = stripParams(websiteUrl)
    const cleanFacebook = stripParams(socialFacebook)
    const cleanPurchaseWebsite = stripParams(purchaseWebsite)
    const cleanPurchasePinkoi = stripParams(purchasePinkoi)
    const cleanPurchaseShopee = stripParams(purchaseShopee)
    const cleanOtherUrls = otherUrls
      .filter((link) => link.label.trim() || link.url.trim())
      .map((link) => ({
        label: link.label.trim(),
        url: stripParams(link.url),
      }))

    return {
      websiteUrl: cleanWebsiteUrl,
      socialInstagram,
      socialThreads,
      socialFacebook: cleanFacebook,
      purchaseWebsite: cleanPurchaseWebsite,
      purchasePinkoi: cleanPurchasePinkoi,
      purchaseShopee: cleanPurchaseShopee,
      otherUrls: cleanOtherUrls,
      instagram: socialInstagram,
      threads: socialThreads,
      facebook: cleanFacebook,
      purchaseLinks: buildPurchaseLinks(),
    }
  }

  const addOtherUrl = () => {
    setOtherUrls((links) => (
      links.length >= MAX_OTHER_LINKS ? links : [...links, { label: '', url: '' }]
    ))
  }

  const removeOtherUrl = (index: number) => {
    setOtherUrls((links) => links.filter((_, linkIndex) => linkIndex !== index))
  }

  const updateOtherUrl = (index: number, key: keyof OtherUrl, value: string) => {
    setOtherUrls((links) =>
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
        <p className="text-xs font-semibold text-foreground">
          {t('url.hint')}
        </p>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground" />
          <Input
            id="website-url"
            type="url"
            placeholder="https://yourbrand.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            disabled={status === 'loading'}
            className="h-12 bg-background pl-10 pr-3 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
          {t('url.socialLinksLabel')}
        </div>
        <div className="space-y-3">
          <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:items-center">
            <label htmlFor="url-instagram" className="text-sm font-semibold text-foreground">
              Instagram
            </label>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">@</span>
              <Input
                id="url-instagram"
                type="text"
                placeholder="yourbrand"
                value={socialInstagram}
                onChange={(e) => setSocialInstagram(stripHandle(e.target.value))}
                disabled={status === 'loading'}
                className="h-12 bg-background pl-7 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:items-center">
            <label htmlFor="url-threads" className="text-sm font-semibold text-foreground">
              Threads
            </label>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">@</span>
              <Input
                id="url-threads"
                type="text"
                placeholder="yourbrand"
                value={socialThreads}
                onChange={(e) => setSocialThreads(stripHandle(e.target.value))}
                disabled={status === 'loading'}
                className="h-12 bg-background pl-7 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:items-center">
            <label htmlFor="url-facebook" className="text-sm font-semibold text-foreground">
              Facebook
            </label>
            <Input
              id="url-facebook"
              type="url"
              placeholder="https://facebook.com/yourbrand"
              value={socialFacebook}
              onChange={(e) => setSocialFacebook(e.target.value)}
              onBlur={(e) => validateUrlField('socialFacebook', e.target.value)}
              aria-invalid={urlErrors.socialFacebook || undefined}
              disabled={status === 'loading'}
              className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {urlErrors.socialFacebook && (
            <p className="text-xs font-semibold text-foreground">{tx('url.urlInvalid', 'Please enter a valid URL.')}</p>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="space-y-2">
          <div className="inline-flex min-h-12 items-center rounded-lg bg-cta px-4 text-[11px] font-semibold uppercase tracking-wide text-cta-foreground">
            {t('url.purchaseLinksLabel')}
          </div>
          <p className="text-xs font-semibold text-foreground">
            {t('url.purchaseLinksHint')}
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:items-center">
            <label htmlFor="purchase-website" className="text-sm font-semibold text-foreground">
              {tx('url.purchaseWebsite', '品牌官網')}
            </label>
            <Input
              id="purchase-website"
              type="url"
              placeholder="https://yourbrand.com"
              value={purchaseWebsite}
              onChange={(e) => setPurchaseWebsite(e.target.value)}
              onBlur={(e) => validateUrlField('purchaseWebsite', e.target.value)}
              aria-invalid={urlErrors.purchaseWebsite || undefined}
              disabled={status === 'loading'}
              className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:items-center">
            <label htmlFor="purchase-pinkoi" className="text-sm font-semibold text-foreground">
              Pinkoi
            </label>
            <Input
              id="purchase-pinkoi"
              type="url"
              placeholder="https://pinkoi.com/..."
              value={purchasePinkoi}
              onChange={(e) => setPurchasePinkoi(e.target.value)}
              onBlur={(e) => validateUrlField('purchasePinkoi', e.target.value)}
              aria-invalid={urlErrors.purchasePinkoi || undefined}
              disabled={status === 'loading'}
              className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:items-center">
            <label htmlFor="purchase-shopee" className="text-sm font-semibold text-foreground">
              {tx('url.purchaseShopee', '蝦皮購物')}
            </label>
            <Input
              id="purchase-shopee"
              type="url"
              placeholder="https://shopee.tw/..."
              value={purchaseShopee}
              onChange={(e) => setPurchaseShopee(e.target.value)}
              onBlur={(e) => validateUrlField('purchaseShopee', e.target.value)}
              aria-invalid={urlErrors.purchaseShopee || undefined}
              disabled={status === 'loading'}
              className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {['purchaseWebsite', 'purchasePinkoi', 'purchaseShopee'].some((field) => urlErrors[field]) && (
            <p className="text-xs font-semibold text-foreground">{tx('url.urlInvalid', 'Please enter a valid URL.')}</p>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {tx('url.otherLinksLabel', 'Other links')}
        </div>
        <div className="space-y-3">
          {otherUrls.map((link, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_48px]">
              <Input
                aria-label={tx('url.otherLinkLabel', 'Link label')}
                placeholder={tx('url.otherLinkLabel', 'Link label')}
                value={link.label}
                onChange={(e) => updateOtherUrl(index, 'label', e.target.value)}
                disabled={status === 'loading'}
                className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Input
                type="url"
                aria-label={t('url.urlAriaLabel', { index: index + 1 })}
                placeholder="https://..."
                value={link.url}
                onChange={(e) => updateOtherUrl(index, 'url', e.target.value)}
                onBlur={(e) => validateUrlField(`other-${index}`, e.target.value)}
                aria-invalid={urlErrors[`other-${index}`] || undefined}
                disabled={status === 'loading'}
                className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('url.removeLink')}
                onClick={() => removeOtherUrl(index)}
                disabled={status === 'loading'}
                className="h-12 w-12 shrink-0 rounded-lg text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {Object.keys(urlErrors).some((field) => field.startsWith('other-') && urlErrors[field]) && (
            <p className="text-xs font-semibold text-foreground">{tx('url.urlInvalid', 'Please enter a valid URL.')}</p>
          )}
        </div>

        {otherUrls.length < MAX_OTHER_LINKS && (
          <Button
            type="button"
            variant="ghost"
            onClick={addOtherUrl}
            disabled={status === 'loading'}
            className="h-12 rounded-lg px-3 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            {tx('url.addLink', '+ 新增連結')}
          </Button>
        )}
      </div>

      {!isOwner && (
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">
            {t('url.howKnowBrand')}
          </label>
          <Select onValueChange={(val) => onAttributionChange(val as SourceAttribution)}>
            <SelectTrigger
              aria-label={t('url.howKnowBrand')}
              className="h-12 w-full border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
        <p className="pl-6 text-xs font-semibold text-foreground">
          {t('url.ownerHint')}{' '}
          <Link href="/faq#claimBenefits" className="underline hover:text-foreground">
            {t('url.ownerLearnMore')}
          </Link>
        </p>
      </div>

      {status === 'error' && (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-semibold text-foreground">
            {t('url.fetchError')}
          </p>
        </div>
      )}

      {loadedBanner && (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-semibold text-foreground">{loadedBanner}</p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        {status === 'loading' ? (
          <>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('url.loading')}
            </div>
            <Button
              type="button"
              onClick={handleCancel}
              variant="ghost"
              className="h-12 text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
              className="h-12 text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.manualFill')}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              onClick={handleFetch}
              disabled={!isValidUrl}
              className="focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.autoFill')}
            </Button>
            <Button
              type="button"
              onClick={() => onSkip(getLinks())}
              variant="ghost"
              className="h-12 text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.skip')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
