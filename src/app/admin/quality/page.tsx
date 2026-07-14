import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { DataCard, SurfaceCard } from '@/components/ui/card'
import { getQualityMetrics } from '@/lib/services/brand-quality'

export const metadata: Metadata = {
  title: 'Quality Dashboard | Admin',
}

export const revalidate = 0

const getCachedMetrics = unstable_cache(
  () => getQualityMetrics(),
  ['quality-metrics'],
  { tags: ['quality-metrics'] }
)

const linkRows = [
  { label: 'Instagram', key: 'socialInstagram' },
  { label: 'Threads', key: 'socialThreads' },
  { label: 'Facebook', key: 'socialFacebook' },
  { label: 'Website', key: 'purchaseWebsite' },
  { label: 'Pinkoi', key: 'purchasePinkoi' },
  { label: 'Shopee', key: 'purchaseShopee' },
] as const

const distributionRows = [
  { label: 'Excellent >=80%', key: 'excellent' },
  { label: 'Good 60-79%', key: 'good' },
  { label: 'Fair 40-59%', key: 'fair' },
  { label: 'Poor <40%', key: 'poor' },
] as const

const enrichmentRows = [
  { label: 'ZH language purity', key: 'languagePurityPct' },
  { label: 'Hero classified', key: 'heroClassifiedPct' },
  { label: 'ZH description coverage', key: 'descriptionCoveragePct' },
  { label: 'EN description coverage', key: 'descriptionEnCoveragePct' },
] as const

type ProgressBarProps = {
  value: number
  label: string
}

function formatPercentage(value: number): string {
  return `${Math.round(value)}%`
}

function ProgressBar({ value, label }: ProgressBarProps) {
  const boundedValue = Math.min(100, Math.max(0, value))

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(boundedValue)}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${boundedValue}%` }}
      />
    </div>
  )
}

export default async function AdminQualityPage() {
  const metrics = await getCachedMetrics()
  const distributionTotal = Object.values(metrics.completeness).reduce(
    (total, count) => total + count,
    0
  )
  const distributionMax = Math.max(...Object.values(metrics.completeness), 0)

  return (
    <div>
      <h1 className="type-page-title-large">
        Quality Dashboard
      </h1>
      <p className="mt-2 text-muted-foreground">
        Track brand data quality for images, links, descriptions, and completeness.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <DataCard
          label="Hero Image Coverage"
          value={formatPercentage(metrics.heroImage.percentage)}
          description={`${metrics.heroImage.withCount} brands with hero / ${metrics.totalBrands} total`}
          padding="sm"
        >
          <ProgressBar
            label="Hero image coverage"
            value={metrics.heroImage.percentage}
          />
        </DataCard>

        <SurfaceCard padding="sm">
          <h2 className="type-metadata">
            Link Coverage
          </h2>
          <div className="mt-4 space-y-4">
            {linkRows.map((row) => {
              const metric = metrics.links[row.key]

              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex min-h-6 items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-foreground">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {metric.count} / {metrics.totalBrands}
                    </span>
                  </div>
                  <ProgressBar
                    label={`${row.label} link coverage`}
                    value={metric.percentage}
                  />
                </div>
              )
            })}
          </div>
        </SurfaceCard>

        <DataCard
          label="Description Completeness"
          value={formatPercentage(metrics.description.percentage)}
          description={`avg length: ${metrics.description.avgLength} chars`}
          padding="sm"
        >
          <ProgressBar
            label="Description completeness"
            value={metrics.description.percentage}
          />
        </DataCard>

        <SurfaceCard padding="sm">
          <h2 className="type-metadata">
            Completeness Distribution
          </h2>
          <div className="mt-4 space-y-4">
            {distributionRows.map((row) => {
              const count = metrics.completeness[row.key]
              const percentage = distributionTotal > 0
                ? (count / distributionTotal) * 100
                : 0
              const relativePercentage = distributionMax > 0
                ? (count / distributionMax) * 100
                : 0

              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex min-h-6 items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-foreground">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {count} ({formatPercentage(percentage)})
                    </span>
                  </div>
                  <ProgressBar
                    label={`${row.label} completeness distribution`}
                    value={relativePercentage}
                  />
                </div>
              )
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard padding="sm" className="md:col-span-2">
          <h2 className="type-metadata">
            Enrichment Quality
          </h2>
          <div className="mt-4 space-y-4">
            {enrichmentRows.map((row) => {
              const value = metrics.enrichment[row.key]

              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex min-h-6 items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-foreground">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatPercentage(value)}
                    </span>
                  </div>
                  <ProgressBar
                    label={`${row.label} enrichment quality`}
                    value={value}
                  />
                </div>
              )
            })}

            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div>
                <p className="type-body-emphasis">Promo hero images</p>
                <p className="mt-1 type-stat">
                  {metrics.enrichment.promoHeroCount}
                </p>
              </div>
              <div>
                <p className="type-body-emphasis">Validation failures</p>
                <p className="mt-1 type-stat">
                  {metrics.enrichment.validationFailures}
                </p>
              </div>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  )
}
