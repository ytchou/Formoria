import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getQualityMetrics } from '@/lib/services/brand-quality'

export const metadata: Metadata = {
  title: '品質儀表板 | 管理後台',
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
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        品質儀表板
      </h1>
      <p className="mt-2 text-muted-foreground">
        追蹤品牌資料的圖片、連結、描述與完整度品質。
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Hero Image Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <p className="font-heading text-4xl font-bold text-foreground">
              {formatPercentage(metrics.heroImage.percentage)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {metrics.heroImage.withCount} brands with hero / {metrics.totalBrands} total
            </p>
            <div className="mt-4">
              <ProgressBar
                label="Hero image coverage"
                value={metrics.heroImage.percentage}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Link Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
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
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Description Completeness
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <p className="font-heading text-4xl font-bold text-foreground">
              {formatPercentage(metrics.description.percentage)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              avg length: {metrics.description.avgLength} chars
            </p>
            <div className="mt-4">
              <ProgressBar
                label="Description completeness"
                value={metrics.description.percentage}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completeness Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
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
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none md:col-span-2">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Enrichment Quality
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
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
                <p className="text-sm font-medium text-foreground">Promo hero images</p>
                <p className="mt-1 font-heading text-3xl font-bold text-foreground">
                  {metrics.enrichment.promoHeroCount}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Validation failures</p>
                <p className="mt-1 font-heading text-3xl font-bold text-foreground">
                  {metrics.enrichment.validationFailures}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
