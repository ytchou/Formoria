'use client'

import { useCallback, useEffect, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/navigation'
import { citySlugToPath } from '@/lib/constants/taiwan-cities'
import { TAIWAN_DISTRICT_CENTROIDS } from '@/lib/constants/taiwan-district-centroids'
import { routes } from '@/lib/routes'

type LocateCopy = {
  idle: string
  locating: string
  denied: string
  unavailable: string
}

function focusHashTarget() {
  const id = decodeURIComponent(window.location.hash.slice(1))
  if (id) document.getElementById(id)?.focus()
}

export function LocateButton({
  copy,
  availableDistrictSlugs,
}: {
  copy: LocateCopy
  availableDistrictSlugs: string[]
}) {
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
        const availableSlugs = new Set(availableDistrictSlugs)
        const candidates = TAIWAN_DISTRICT_CENTROIDS.filter((candidate) =>
          availableSlugs.has(candidate.district),
        )
        const first = candidates.at(0)
        if (!first) {
          setLoading(false)
          return setStatus(copy.unavailable)
        }
        const nearest = candidates.reduce(
          (best, candidate) => {
            const distance =
              (candidate.latitude - coords.latitude) ** 2 +
              (candidate.longitude - coords.longitude) ** 2
            return distance < best.distance ? { candidate, distance } : best
          },
          { candidate: first, distance: Number.POSITIVE_INFINITY },
        )
        setLoading(false)
        setStatus('')
        router.push(
          `${routes.whereToBuyCity(citySlugToPath(nearest.candidate.city))}#${nearest.candidate.district}`,
        )
      },
      (error) => {
        setLoading(false)
        setStatus(
          error.code === error.PERMISSION_DENIED
            ? copy.denied
            : copy.unavailable,
        )
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [availableDistrictSlugs, copy, router])

  return (
    <div>
      <Button type="button" onClick={locate} disabled={loading}>
        <LocateFixed aria-hidden="true" className="size-5" />
        {loading ? copy.locating : copy.idle}
      </Button>
      <p
        role="status"
        className="mt-2 min-h-6 type-metadata text-ink-muted"
      >
        {status}
      </p>
    </div>
  )
}
