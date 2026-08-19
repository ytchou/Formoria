'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

/**
 * A tab left open across a deploy posts a Server Action ID the new build no
 * longer has. Next.js surfaces this two ways — server-side as "Failed to find
 * Server Action", client-side as the router's generic "unexpected response".
 * Neither is recoverable by `reset()`, which re-runs the same stale bundle, so
 * these need a hard reload instead (DEV-1340 / FORMORIA-4R, FORMORIA-55).
 */
function isDeploymentSkewError(error: Error): boolean {
  return (
    error.message.includes('Failed to find Server Action') ||
    error.message.includes('An unexpected response was received from the server')
  )
}

type RouteErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
  titleKey?: string
  descriptionKey?: string
  titleClassName?: string
}

export function RouteError({
  error,
  reset,
  titleKey = 'boundary.title',
  descriptionKey = 'boundary.description',
  titleClassName = 'type-section',
}: RouteErrorProps) {
  const t = useTranslations('errors')
  const isStale = isDeploymentSkewError(error)

  useEffect(() => {
    // Still reported, but tagged and downgraded: deploy skew is expected and
    // unactionable, and at full severity it drowns out real regressions.
    Sentry.captureException(error, isStale ? { level: 'warning', tags: { deployment_skew: true } } : undefined)
  }, [error, isStale])

  return (
    <main className="page-gutter mx-auto flex page-measure flex-col items-center justify-center py-section text-center">
      <h1 className={titleClassName}>
        {isStale ? t('boundary.staleTitle') : t(titleKey)}
      </h1>
      <p className="mt-3 type-body-sm">
        {isStale ? t('boundary.staleDescription') : t(descriptionKey)}
      </p>
      <Button
        variant="primary"
        onClick={isStale ? () => window.location.reload() : reset}
        className="mt-6"
      >
        {isStale ? t('boundary.staleRetry') : t('boundary.retry')}
      </Button>
    </main>
  )
}
