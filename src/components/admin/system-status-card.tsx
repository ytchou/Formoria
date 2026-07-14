'use client'

import { useTransition } from 'react'
import { refreshHealthChecks } from '@/app/admin/actions'
import type { ServiceHealthResult } from '@/lib/services/health-checks'
import { Button } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'

const STATUS_DOT: Record<ServiceHealthResult['status'], string> = {
  healthy: 'bg-verified-green',
  degraded: 'bg-mit-verified',
  down: 'bg-destructive',
  unconfigured: 'bg-muted-foreground',
}

export function SystemStatusCard({ initialResults }: { initialResults: ServiceHealthResult[] }) {
  const [isPending, startTransition] = useTransition()

  const overallStatus =
    initialResults.some((r) => r.status === 'down')
      ? 'down'
      : initialResults.some((r) => r.status === 'degraded')
        ? 'degraded'
        : 'healthy'

  function handleRefresh() {
    startTransition(async () => {
      await refreshHealthChecks()
    })
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[overallStatus]}`} />
          <h2 className="type-section-title-large">System Status</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="type-caption">Auto-refreshes on page load</span>
          <Button
            variant="secondary"
            size="compact"
            onClick={handleRefresh}
            disabled={isPending}
          >
            {isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      <SurfaceCard padding="lg" className="space-y-2">
          {initialResults.length === 0 && (
            <p className="text-center type-card-description">No data</p>
          )}
          {initialResults.map((result) => (
            <div key={result.service} className="flex items-center justify-between text-sm">
              <span className="font-medium">{result.service}</span>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[result.status]}`} />
                <span>{result.message}</span>
              </div>
            </div>
          ))}
      </SurfaceCard>
    </section>
  )
}
