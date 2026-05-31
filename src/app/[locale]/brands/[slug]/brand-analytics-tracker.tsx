'use client'
import { useEffect } from 'react'

export function BrandAnalyticsTracker({ brandId }: { brandId: string }) {
  useEffect(() => {
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId, event: 'view' }),
    }).catch(() => {})
  }, [brandId])
  return null
}
