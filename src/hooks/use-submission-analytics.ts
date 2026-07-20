'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  trackSubmissionFormAbandoned,
  trackSubmissionFormOpened,
  trackSubmissionFormStepCompleted,
} from '@/lib/analytics'

type SubmissionSource = Parameters<typeof trackSubmissionFormOpened>[0]
type SubmissionIntent = Parameters<typeof trackSubmissionFormOpened>[1]

export function useSubmissionAnalytics(
  source: SubmissionSource,
  intent: SubmissionIntent,
  initialStep: string,
) {
  const startedAtRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const initializedRef = useRef(false)
  const abandonmentTrackedRef = useRef(false)
  const lastCompletedStepRef = useRef(initialStep)
  const pendingCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const abandon = useCallback(() => {
    if (completedRef.current || abandonmentTrackedRef.current) return
    abandonmentTrackedRef.current = true
    trackSubmissionFormAbandoned(
      lastCompletedStepRef.current,
      startedAtRef.current === null
        ? 0
        : Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
    )
  }, [])

  useEffect(() => {
    if (pendingCleanupRef.current) clearTimeout(pendingCleanupRef.current)
    if (!initializedRef.current) {
      initializedRef.current = true
      startedAtRef.current = Date.now()
      lastCompletedStepRef.current = initialStep
      trackSubmissionFormOpened(source, intent)
    }
    window.addEventListener('pagehide', abandon)

    return () => {
      window.removeEventListener('pagehide', abandon)
      pendingCleanupRef.current = setTimeout(abandon, 0)
    }
  }, [abandon, initialStep, intent, source])

  const stepCompleted = useCallback((step: string) => {
    lastCompletedStepRef.current = step
    trackSubmissionFormStepCompleted(step)
  }, [])

  const complete = useCallback((): number => {
    completedRef.current = true
    return startedAtRef.current === null
      ? 0
      : Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000))
  }, [])

  return { complete, stepCompleted }
}
