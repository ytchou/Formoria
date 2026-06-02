'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Link2, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { SourceAttribution } from '@/lib/types/submission'
import type { ScrapedBrandData } from '@/lib/types/scraper'

type UrlStepStatus = 'idle' | 'loading' | 'error'

type UrlRow = {
  id: string
  value: string
}

type ScrapeStatus = {
  ok: boolean
}

type UrlStepProps = {
  onSuccess: (data: ScrapedBrandData) => void
  onSkip: () => void
  isOwner: boolean
  onOwnerChange: (isOwner: boolean) => void
  onAttributionChange: (attribution: SourceAttribution | undefined) => void
}

export function UrlStep({ onSuccess, onSkip, isOwner, onOwnerChange, onAttributionChange }: UrlStepProps) {
  const t = useTranslations('submit')
  const [urlRows, setUrlRows] = useState<UrlRow[]>([
    { id: 'website-url', value: '' },
  ])
  const [status, setStatus] = useState<UrlStepStatus>('idle')
  const [loadedBanner, setLoadedBanner] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const filledUrls = urlRows
    .map((row) => row.value.trim())
    .filter(Boolean)
  const isValidUrl = filledUrls.length > 0 && filledUrls.every((url) => url.startsWith('https://'))

  const updateUrlRow = (id: string, value: string) => {
    setUrlRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, value } : row))
    )
  }

  const addUrlRow = () => {
    setUrlRows((rows) => {
      if (rows.length >= 3) return rows
      return [...rows, { id: `website-url-${Date.now()}`, value: '' }]
    })
  }

  const removeUrlRow = (id: string) => {
    setUrlRows((rows) => {
      if (rows.length === 1) return rows
      return rows.filter((row) => row.id !== id)
    })
  }

  const handleFetch = async () => {
    if (!isValidUrl) return

    setStatus('loading')
    setLoadedBanner(null)

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: filledUrls }),
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
      onSuccess(data)
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
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {t('url.heading')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('url.subheading')}
        </p>
      </div>

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
        <div className="space-y-2">
          {urlRows.map((row, index) => {
            const inputId = index === 0 ? 'website-url' : row.id
            return (
              <div key={row.id} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={inputId}
                    type="url"
                    aria-label={index === 0 ? undefined : t('url.urlAriaLabel', { index: index + 1 })}
                    placeholder="https://yourbrand.com"
                    value={row.value}
                    onChange={(e) => updateUrlRow(row.id, e.target.value)}
                    disabled={status === 'loading'}
                    className="h-11 bg-background pl-10 pr-3 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                {urlRows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('url.removeLink')}
                    onClick={() => removeUrlRow(row.id)}
                    disabled={status === 'loading'}
                    className="h-12 w-12 rounded-lg p-2 text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
        {urlRows.length < 3 && (
          <Button
            type="button"
            variant="ghost"
            onClick={addUrlRow}
            disabled={status === 'loading'}
            className="h-12 rounded-lg px-2 text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            {t('url.addLink')}
          </Button>
        )}
      </div>

      {/* Brand owner checkbox */}
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

      {/* Source attribution — shown only when not owner */}
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
              <SelectValue placeholder={t('url.howKnowPlaceholder')} />
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
              onClick={onSkip}
              variant="ghost"
              className="h-12 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
              onClick={onSkip}
              variant="ghost"
              className="h-12 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('url.skip')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
