import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { surfaceCardStyles } from '@/components/ui/card'
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
    return <Badge variant="destructive">{t('riskHigh')}</Badge>
  }

  return (
    <Badge className="border border-mit-verified/20 bg-mit-verified-bg text-mit-verified">
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
      <h1 className="type-page-title-large">
        {t('dashboard')}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {t('flagCount', { count: items.length })}
      </p>

      <form className="mt-6 flex flex-wrap gap-3">
        <Label className="flex flex-col gap-1 type-body-emphasis text-muted-foreground">
          {t('filterByRisk')}
          <NativeSelect
            name="risk"
            defaultValue={riskFilter ?? ''}
            className="h-10"
          >
            <option value="">{t('flagCount', { count: unfilteredItems.length })}</option>
            <option value="high">{t('riskHigh')}</option>
            <option value="medium">{t('riskMedium')}</option>
            <option value="clean">{t('riskClean')}</option>
          </NativeSelect>
        </Label>
        <Label className="flex flex-col gap-1 type-body-emphasis text-muted-foreground">
          {t('filterByTier')}
          <NativeSelect
            name="tier"
            defaultValue={tierFilter ?? ''}
            className="h-10"
          >
            <option value="">{t('flagCount', { count: unfilteredItems.length })}</option>
            <option value="block">block</option>
            <option value="flag">flag</option>
          </NativeSelect>
        </Label>
        <Button
          type="submit"
          variant="secondary"
          className="self-end"
        >
          {t('filterByRisk')}
        </Button>
      </form>

      <div className={surfaceCardStyles({ className: 'mt-8 overflow-hidden', padding: 'none' })}>
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
