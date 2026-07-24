import type { LucideIcon } from 'lucide-react'
import { FileText, Link2, ShieldCheck, Star } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import type { Brand } from '@/lib/types'

type SummaryRow = {
  label: string
  value: React.ReactNode
}

function SummaryCard({
  editHref,
  editLabel,
  icon: Icon,
  rows,
  title,
}: {
  editHref: string
  editLabel: string
  icon: LucideIcon
  rows: SummaryRow[]
  title: string
}) {
  return (
    <SurfaceCard padding="sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="type-card-title">{title}</h2>
        </div>
        <Link
          aria-label={`${editLabel}: ${title}`}
          className={buttonVariants({
            variant: 'ghost',
            size: 'compact',
            className: 'min-h-12 min-w-12',
          })}
          href={editHref}
        >
          {editLabel}
        </Link>
      </div>
      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div className="flex items-start justify-between gap-3" key={row.label}>
            <dt className="type-micro text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-right type-body">{row.value}</dd>
          </div>
        ))}
      </dl>
    </SurfaceCard>
  )
}

export async function SectionSummaryCards({
  brand,
  slug,
}: {
  brand: Brand
  slug: string
}) {
  const [tOverview, tEdit, tProfile, tMit] = await Promise.all([
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.edit'),
    getTranslations('dashboard.brandProfile'),
    getTranslations('dashboard.mit'),
  ])
  const editBase = `/dashboard/brands/${slug}/edit?step=`
  const socialCount = [
    brand.socialInstagram,
    brand.socialThreads,
    brand.socialFacebook,
  ].filter(Boolean).length
  const mitStatus = brand.mitStatus ?? 'unverified'
  const verificationVariant =
    mitStatus === 'verified'
      ? 'verified'
      : mitStatus === 'declared'
        ? 'declared'
        : 'secondary'

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <SummaryCard
        editHref={`${editBase}1`}
        editLabel={tProfile('edit')}
        icon={FileText}
        rows={[
          {
            label: tEdit('fieldHeroImage'),
            value: safeImageSrc(brand.heroImageUrl) ? '1' : '0',
          },
          {
            label: tEdit('fieldProductPhotos'),
            value: brand.productPhotos.length,
          },
        ]}
        title={tOverview('sectionMediaTitle')}
      />
      <SummaryCard
        editHref={`${editBase}2`}
        editLabel={tProfile('edit')}
        icon={Link2}
        rows={[
          { label: tProfile('socialLinks'), value: socialCount },
        ]}
        title={tOverview('sectionLinksTitle')}
      />
      <SummaryCard
        editHref={`/dashboard/brands/${slug}/verification`}
        editLabel={tProfile('edit')}
        icon={ShieldCheck}
        rows={[
          {
            label: tMit('title'),
            value: (
              <Badge variant={verificationVariant}>
                {tMit(`status.${mitStatus}`)}
              </Badge>
            ),
          },
          {
            label: tMit('tier.declareTitle'),
            value: brand.mitDeclaredScope
              ? tMit(`declare.scope.${brand.mitDeclaredScope}`)
              : '—',
          },
        ]}
        title={tOverview('sectionVerificationTitle')}
      />
      <SummaryCard
        editHref={`${editBase}4`}
        editLabel={tProfile('edit')}
        icon={Star}
        rows={[
          {
            label: tEdit('fieldReputationSummary'),
            value: brand.reputationSummary?.text ? (
              <span className="line-clamp-2">{brand.reputationSummary.text}</span>
            ) : '—',
          },
          {
            label: tEdit('fieldProvenanceSources'),
            value: brand.reputationSummary?.sources.length ?? 0,
          },
        ]}
        title={tEdit('wizardStepReputation')}
      />
    </div>
  )
}
