'use client'

import { useState, useRef } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import type { ScrapedBrandData } from '@/lib/types/scraper'

type UrlStepStatus = 'idle' | 'loading' | 'error'

type UrlStepProps = {
  onSuccess: (data: ScrapedBrandData) => void
  onSkip: () => void
}

export function UrlStep({ onSuccess, onSkip }: UrlStepProps) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<UrlStepStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const isValidUrl = url.startsWith('https://')

  const handleFetch = async () => {
    if (!isValidUrl) return

    setStatus('loading')

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        setStatus('error')
        return
      }

      const data = await response.json()
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
    <div className="mx-auto max-w-[600px] space-y-6">
      <div className="space-y-1.5">
        <label
          htmlFor="website-url"
          className="block text-sm font-semibold text-[#1A1918]"
        >
          Website URL
        </label>
        <p className="text-xs text-[#7C7570]">
          Paste your brand&apos;s website URL and we&apos;ll auto-fill your
          submission
        </p>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B0AAA4]" />
          <input
            id="website-url"
            type="url"
            placeholder="https://yourbrand.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={status === 'loading'}
            className="h-11 w-full rounded-lg border border-[#D4CFC9] bg-white pl-10 pr-3 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20 disabled:opacity-50"
          />
        </div>
      </div>

      {status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">
            Could not fetch brand info. Please try again or fill in the form
            manually.
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        {status === 'loading' ? (
          <>
            <div className="inline-flex items-center gap-2 text-sm text-[#7C7570]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching brand info...
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
            >
              Cancel
            </button>
          </>
        ) : status === 'error' ? (
          <>
            <button
              type="button"
              onClick={handleFetch}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
            >
              Fill manually instead
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleFetch}
              disabled={!isValidUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Fetch Brand Info
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
            >
              Skip and fill manually
            </button>
          </>
        )}
      </div>
    </div>
  )
}
