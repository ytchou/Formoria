'use client'

import { useEffect, useRef } from 'react'
import { trackOnboardingMilestoneReached } from '@/lib/analytics'

type OnboardingMilestone = Parameters<typeof trackOnboardingMilestoneReached>[1]

type MilestoneTrackerProps = {
  milestone: string | null
  slug: string
}

const MILESTONE_EVENTS: Record<string, OnboardingMilestone> = {
  'dashboard.onboarding.milestone.gettingStarted': 'getting_started',
  'dashboard.onboarding.milestone.halfway': 'halfway',
  'dashboard.onboarding.milestone.complete': 'complete',
}

export function MilestoneTracker({ milestone, slug }: MilestoneTrackerProps) {
  const trackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (milestone === null) return

    const eventMilestone = MILESTONE_EVENTS[milestone]
    if (!eventMilestone) return

    const trackingKey = `${slug}:${eventMilestone}`
    if (trackedRef.current === trackingKey) return

    trackedRef.current = trackingKey
    trackOnboardingMilestoneReached(slug, eventMilestone)
  }, [milestone, slug])

  return null
}
