import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Brand } from '@/lib/types/brand'
import { CONTACT_EMAILS } from '@/lib/constants'

type MitStatus = NonNullable<Brand['mitStatus']>

const STATUS_CLASSES: Record<MitStatus, string> = {
  unverified: 'bg-[#F5F4F1] text-[#7C7570]',
  claimed: 'bg-[#F5F4F1] text-[#7C7570]',
  verified: 'bg-[#EAF3E8] text-[#2D5A27]',
  rejected: 'bg-[#FDF3EC] text-[#D94F3D]',
}

type Props = {
  brand: Brand
}

export async function MitStatusCard({ brand }: Props) {
  const t = await getTranslations('dashboard.mit')
  const mitStatus: MitStatus = brand.mitStatus ?? 'unverified'
  const mitEvidence = brand.mitEvidence

  const mailtoHref = `mailto:${CONTACT_EMAILS.operations}?subject=${encodeURIComponent(`MIT 驗證申請 — ${brand.name} (${brand.slug})`)}`

  return (
    <Card className="border-[#E5E0D8] bg-white shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold text-foreground">
          {t('title')}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-left">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[mitStatus]}`}
          >
            {t(`status.${mitStatus}`)}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {t(`description.${mitStatus}`)}
        </p>

        {mitEvidence?.mit_smile_cert ? (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {t('certLabel')}
            </p>
            <p className="mt-1 text-sm">{mitEvidence.mit_smile_cert}</p>
          </div>
        ) : null}

        {mitStatus === 'rejected' && mitEvidence?.notes ? (
          <div className="rounded-md bg-[#FDF3EC] px-3 py-2">
            <p className="text-xs font-medium text-[#D94F3D]">
              {t('reviewNote')}
            </p>
            <p className="mt-1 text-sm text-[#7C2D00]">{mitEvidence.notes}</p>
          </div>
        ) : null}

        {mitStatus !== 'verified' ? (
          <a
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#C25B3F] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            href={mailtoHref}
          >
            {t('resubmitCta')}
          </a>
        ) : null}
      </CardContent>
    </Card>
  )
}
