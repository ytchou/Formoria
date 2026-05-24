'use client'

import { useState, useRef } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import type { ScrapedBrandData } from '@/lib/types/scraper'

type UrlStepStatus = 'idle' | 'loading' | 'error'

const SOURCE_ATTRIBUTION_LABELS: Record<(typeof SOURCE_ATTRIBUTION_VALUES)[number], string> = {
  bought_product: '買過他們的產品',
  saw_at_market: '在市集或實體店看到',
  found_online: '在網路上發現',
  friend_recommended: '朋友推薦',
  work_there: '在這裡工作',
}

type UrlStepProps = {
  onSuccess: (data: ScrapedBrandData) => void
  onSkip: () => void
  isOwner: boolean
  onOwnerChange: (isOwner: boolean) => void
  onAttributionChange: (attribution: string | undefined) => void
}

export function UrlStep({ onSuccess, onSkip, isOwner, onOwnerChange, onAttributionChange }: UrlStepProps) {
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
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-[#1A1918]">
          提交你喜愛的品牌
        </h2>
        <p className="text-sm text-[#7C7570]">
          與社群分享台灣製造品牌
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="website-url"
          className="block text-sm font-semibold text-[#1A1918]"
        >
          品牌網站 URL
        </label>
        <p className="text-xs text-[#7C7570]">
          貼上品牌網站的網址，我們將自動填入您的提交資料
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

      {/* Brand owner checkbox */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="is-brand-owner"
          checked={isOwner}
          onCheckedChange={(checked: boolean) => onOwnerChange(checked)}
        />
        <label
          htmlFor="is-brand-owner"
          className="cursor-pointer select-none text-sm font-medium text-[#1A1918]"
        >
          我是品牌所有者
        </label>
      </div>

      {/* Source attribution — shown only when not owner */}
      {!isOwner && (
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-[#1A1918]">
            你如何認識這個品牌？
          </label>
          <Select onValueChange={(val) => onAttributionChange(typeof val === 'string' ? val : undefined)}>
            <SelectTrigger
              aria-label="你如何認識這個品牌？"
              className="h-11 w-full border-[#D4CFC9] text-sm text-[#1A1918]"
            >
              <SelectValue placeholder="選擇你認識這品牌的方式（可選）" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_ATTRIBUTION_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {SOURCE_ATTRIBUTION_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">
            無法取得品牌資訊，請再試一次或手動填寫表單。
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        {status === 'loading' ? (
          <>
            <div className="inline-flex items-center gap-2 text-sm text-[#7C7570]">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在取得品牌資訊...
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
            >
              取消
            </button>
          </>
        ) : status === 'error' ? (
          <>
            <button
              type="button"
              onClick={handleFetch}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33]"
            >
              再試一次
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
            >
              改為手動填寫
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
              自動填入品牌資訊
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
            >
              跳過，手動填寫
            </button>
          </>
        )}
      </div>
    </div>
  )
}
