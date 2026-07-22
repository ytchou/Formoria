import { getTranslations } from 'next-intl/server'
import dynamic from 'next/dynamic'

import { MitDeclaredBadge, MitVerifiedBadge } from '@/components/brands/brand-verification-badges'
import { Button } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import type { Brand } from '@/lib/types'

const EvidenceDialog = dynamic(() =>
  import('@/components/brands/evidence-dialog').then((module) => module.EvidenceDialog)
)

type MitStatusSectionProps = {
  brand: Brand
  locale: string
}

function formatDeclaredDate(value: string, locale: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Taipei',
  }).format(date)
}

export async function MitStatusSection({ brand, locale }: MitStatusSectionProps) {
  const t = await getTranslations('brandDetail')
  const isDeclared = brand.mitStatus === 'declared'
  const isVerified = brand.mitStatus === 'verified'
  const hasStatusDetails = isDeclared || isVerified
  const declaredDate =
    isDeclared && brand.mitDeclaredAt
      ? formatDeclaredDate(brand.mitDeclaredAt, locale)
      : null
  const certificate = isVerified ? brand.mitEvidence?.mit_smile_cert : undefined

  return (
    <SurfaceCard id="mit-status-section" padding="none" className="rounded-md">
      {isDeclared && (
        <div className="space-y-3 p-5">
          <MitDeclaredBadge label={t('mitDeclared')} title={t('mitDeclaredTitle')} />
          {brand.mitDeclaredScope && (
            <p className="type-body-sm text-foreground">
              {t(`mitStatus.scope.${brand.mitDeclaredScope}`)}
            </p>
          )}
          {declaredDate && (
            <p className="type-caption">
              {t('mitStatus.declaredOn', { date: declaredDate })}
            </p>
          )}
        </div>
      )}

      {isVerified && (
        <div className="space-y-3 p-5">
          <MitVerifiedBadge label={t('mitVerified')} title={t('mitVerifiedTitle')} />
          {certificate && (
            <p className="type-body-sm text-foreground">
              {t('mitProofLink', { cert: certificate })}
            </p>
          )}
          <p className="type-caption">{t('mitStatus.registrySource')}</p>
        </div>
      )}

      <div className={hasStatusDetails ? 'border-t border-border p-2' : 'p-2'}>
        <div className="[&:has([data-evidence-dialog-trigger])>[data-evidence-dialog-fallback]]:hidden">
          <EvidenceDialog brandId={brand.id} brandSlug={brand.slug} />
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 w-full justify-start rounded-lg"
            data-evidence-dialog-fallback
            disabled
          >
            {t('mitStatus.reportOrigin')}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  )
}
