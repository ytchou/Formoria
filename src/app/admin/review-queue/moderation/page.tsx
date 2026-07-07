import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table'
import { requireAdminPage } from '@/lib/auth/require-admin'
import { getFlaggedContent } from '@/lib/services/moderation'
import type { ModerationTier } from '@/lib/services/moderation'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.moderation')

  return {
    title: t('dashboard'),
  }
}

type RiskFilter = 'high' | 'medium' | 'clean'
type TierFilter = ModerationTier

interface ModerationPageProps {
  searchParams: Promise<{
    risk?: string
    tier?: string
  }>
}

function formatDate(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}

function truncateContent(value: string) {
  return value.length > 50 ? `${value.slice(0, 50)}...` : value
}

function TierBadge({ tier }: { tier: ModerationTier }) {
  if (tier === 'block') {
    return <Badge variant="destructive">{tier}</Badge>
  }

  return <Badge variant="outline">{tier}</Badge>
}

function getRiskLevel(tier: ModerationTier): RiskFilter {
  return tier === 'block' ? 'high' : 'medium'
}

function normalizeRiskFilter(value?: string): RiskFilter | undefined {
  return value === 'high' || value === 'medium' || value === 'clean' ? value : undefined
}

function normalizeTierFilter(value?: string): TierFilter | undefined {
  return value === 'block' || value === 'flag' ? value : undefined
}

function RiskBadge({
  tier,
  t,
}: {
  tier: ModerationTier
  t: Awaited<ReturnType<typeof getTranslations<'admin.moderation'>>>
}) {
  if (tier === 'block') {
    return <Badge className="bg-destructive text-white">{t('riskHigh')}</Badge>
  }

  return (
    <Badge className="bg-amber-50 text-amber-700 border border-amber-200">
      {t('riskMedium')}
    </Badge>
  )
}

export default async function ReviewQueueModerationPage({ searchParams }: ModerationPageProps) {
  await requireAdminPage('/admin/review-queue/moderation')
  const t = await getTranslations('admin.moderation')
  const params = await searchParams
  const riskFilter = normalizeRiskFilter(params.risk)
  const tierFilter = normalizeTierFilter(params.tier)
  const { items: unfilteredItems } = await getFlaggedContent({
    status: 'pending',
    tier: tierFilter,
  })
  const items = riskFilter
    ? unfilteredItems.filter((item) => getRiskLevel(item.tier) === riskFilter)
    : unfilteredItems

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {t('dashboard')}
      </h1>
      <p className="mt-2 text-warm-caption">
        {t('flagCount', { count: items.length })}
      </p>

      <form className="mt-6 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-warm-caption">
          {t('filterByRisk')}
          <select
            name="risk"
            defaultValue={riskFilter ?? ''}
            className="rounded-md border bg-white px-3 py-2 text-foreground"
          >
            <option value="">{t('flagCount', { count: unfilteredItems.length })}</option>
            <option value="high">{t('riskHigh')}</option>
            <option value="medium">{t('riskMedium')}</option>
            <option value="clean">{t('riskClean')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-warm-caption">
          {t('filterByTier')}
          <select
            name="tier"
            defaultValue={tierFilter ?? ''}
            className="rounded-md border bg-white px-3 py-2 text-foreground"
          >
            <option value="">{t('flagCount', { count: unfilteredItems.length })}</option>
            <option value="block">block</option>
            <option value="flag">flag</option>
          </select>
        </label>
        <Button
          type="submit"
          variant="outline"
          className="self-end"
        >
          {t('filterByRisk')}
        </Button>
      </form>

      <div className="mt-8 rounded-lg border bg-white">
        <Table>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.brandName}</TableCell>
                <TableCell>{item.fieldName}</TableCell>
                <TableCell>
                  <TierBadge tier={item.tier} />
                </TableCell>
                <TableCell>{item.reason}</TableCell>
                <TableCell className="max-w-xs truncate">
                  {truncateContent(item.flaggedContent)}
                </TableCell>
                <TableCell>
                  <RiskBadge tier={item.tier} t={t} />
                </TableCell>
                <TableCell>{formatDate(item.createdAt)}</TableCell>
              </TableRow>
            ))}

            {items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t('noFlaggedContent')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
