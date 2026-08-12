'use client'

import { useCallback, useEffect, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import { citySlugToPath } from '@/lib/constants/taiwan-cities'
import { TAIWAN_DISTRICT_CENTROIDS } from '@/lib/constants/taiwan-district-centroids'

type LocateCopy = { idle: string; locating: string; denied: string; unavailable: string }

function focusHashTarget() {
  const id = decodeURIComponent(window.location.hash.slice(1))
  if (id) document.getElementById(id)?.focus()
}

export function LocateButton({ copy }: { copy: LocateCopy }) {
  const router = useRouter()
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    focusHashTarget()
    window.addEventListener('hashchange', focusHashTarget)
    return () => window.removeEventListener('hashchange', focusHashTarget)
  }, [])

  const locate = useCallback(() => {
    if (!navigator.geolocation) return setStatus(copy.unavailable)
    setLoading(true)
    setStatus(copy.locating)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const first = TAIWAN_DISTRICT_CENTROIDS.at(0)
        if (!first) return setStatus(copy.unavailable)
        const nearest = TAIWAN_DISTRICT_CENTROIDS.reduce((best, candidate) => {
          const distance = (candidate.latitude - coords.latitude) ** 2 + (candidate.longitude - coords.longitude) ** 2
          return distance < best.distance ? { candidate, distance } : best
        }, { candidate: first, distance: Number.POSITIVE_INFINITY })
        setLoading(false)
        setStatus('')
        router.push(`/where-to-buy/${citySlugToPath(nearest.candidate.city)}#${nearest.candidate.district}`)
      },
      (error) => {
        setLoading(false)
        setStatus(error.code === error.PERMISSION_DENIED ? copy.denied : copy.unavailable)
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [copy, router])

  return (
    <div>
      <button type="button" onClick={locate} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary disabled:opacity-60">
        <LocateFixed aria-hidden="true" className="size-5" />
        {loading ? copy.locating : copy.idle}
      </button>
      <p role="status" className="mt-2 min-h-6 text-sm text-muted-foreground">{status}</p>
    </div>
  )
}
