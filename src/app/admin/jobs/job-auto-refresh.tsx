'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 5s polling against `revalidate = 0` admin pages meant ~17k server renders/day per
// idle open tab. 30s still reads as "live" for someone watching a job, and polling is
// suspended entirely while the tab is hidden — a background tab costs nothing. Coming
// back to the tab refreshes immediately, so no progress is missed.
const REFRESH_INTERVAL_MS = 30_000

export function JobAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return

    let interval: number | undefined

    const stop = () => {
      if (interval !== undefined) {
        window.clearInterval(interval)
        interval = undefined
      }
    }

    const start = () => {
      if (interval !== undefined) return
      interval = window.setInterval(() => router.refresh(), REFRESH_INTERVAL_MS)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        router.refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [active, router])

  return null
}
