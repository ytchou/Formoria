'use client'
import { useEffect, useRef } from 'react'
import { bucketSource } from '@/lib/analytics/source-bucket'

export function BrandAnalyticsTracker({ brandId }: { brandId: string }) {
  const trackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (trackedRef.current === brandId) return
    trackedRef.current = brandId

    const source = new URLSearchParams(window.location.search).get('source') ?? undefined
    const bucket = bucketSource(
      source,
      typeof document !== 'undefined' ? document.referrer : '',
      typeof window !== 'undefined' ? window.location.host : ''
    )

    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId, event: 'view', source: bucket }),
    }).catch(() => {})
  }, [brandId])
  return null
}
