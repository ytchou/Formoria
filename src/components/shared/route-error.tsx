'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
import { isDeploymentSkewError } from '@/lib/observability/deployment-skew'

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
    // `prose`, not `page`: this is one centred sentence and a button. On the
    // page measure the line would run the full 1472px of content, which is
    // three times the length anything here reads at.
    <PageShell
      as="main"
      measure="prose"
      className="flex flex-col items-center justify-center py-section text-center"
    >
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
    </PageShell>
  )
}
