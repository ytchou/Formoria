'use client'

import { useEffect } from 'react'
import { trackSessionStart } from '@/lib/analytics'

const STORAGE_KEY = 'mit_last_visit'
const RETURNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function SessionTracker() {
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    let isReturning = false
    let daysSinceLastVisit: number | null = null

    if (raw) {
      const lastVisit = Number(raw)
      if (!Number.isNaN(lastVisit)) {
        const deltaMs = Date.now() - lastVisit
        if (deltaMs <= RETURNING_WINDOW_MS) {
          isReturning = true
          daysSinceLastVisit = Math.floor(deltaMs / 86_400_000)
        }
      }
    }

    trackSessionStart(isReturning, daysSinceLastVisit)
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  }, [])

  return null
}
