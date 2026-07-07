import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getProductTypeLabel } from '@/lib/brands/category-label'
import type { Brand } from '@/lib/types'

type OwnerSectionProps = {
  children: React.ReactNode
  editHref: string
  title: string
  editLabel: string
}

function OwnerSection({ children, editHref, title, editLabel }: OwnerSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-heading text-base font-bold text-foreground">{title}</h2>
        <Link
          aria-label={`${editLabel}: ${title}`}
          className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
          href={editHref}
        >
          {editLabel}
        </Link>
      </div>
      <div className="rounded-xl border border-border bg-card p-5">{children}</div>
    </section>
  )
}

function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{value}</dd>
    </div>
  )
}

function display(value: string | number | null | undefined, fallback: string) {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

export async function OwnerBrandOverview({ brand }: { brand: Brand }) {
  const [locale, t, tEdit] = await Promise.all([
    getLocale(),
    getTranslations('dashboard.brandProfile'),
    getTranslations('dashboard.edit'),
  ])
  const editBase = `/dashboard/brands/${brand.slug}/edit?step=`
  const priceRange = brand.priceRange
    ? tEdit(
        brand.priceRange === 1
          ? 'fieldPriceRangeBudget'
          : brand.priceRange === 2
            ? 'fieldPriceRangeMidRange'
            : 'fieldPriceRangePremium',
      )
    : t('notSet')

  return (
    <div className="space-y-8">
      <OwnerSection editHref={`${editBase}0`} title={tEdit('wizardStepBasicInfo')} editLabel={t('edit')}>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label={tEdit('fieldBrandName')} value={display(brand.name, t('notSet'))} />
          <Field
            label={tEdit('fieldProductType')}
            value={brand.productType
              ? (getProductTypeLabel(brand.productType, locale === 'zh-TW' ? 'zh-TW' : 'en') ?? brand.productType)
              : t('notSet')}
          />
          <Field label={tEdit('fieldDescription')} value={display(brand.description, t('notSet'))} wide />
          <Field label={tEdit('fieldFoundingYear')} value={display(brand.foundingYear, t('notSet'))} />
          <Field label={tEdit('city')} value={display(brand.city, t('notSet'))} />
          <Field label={tEdit('fieldPriceRange')} value={priceRange} />
          <Field
            label={tEdit('fieldProductTags')}
            value={brand.productTags.length > 0 ? brand.productTags.join(' · ') : t('notSet')}
          />
          <Field label={tEdit('mitStoryLabel')} value={display(brand.mitStory, t('notSet'))} wide />
        </dl>
      </OwnerSection>

      <OwnerSection editHref={`${editBase}1`} title={tEdit('wizardStepMedia')} editLabel={t('edit')}>
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{tEdit('fieldHeroImage')}</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {tEdit('heroImageOverviewHint')}
            </p>
            {brand.heroImageUrl ? (
              <div className="relative aspect-[16/9] max-w-md overflow-hidden rounded-xl bg-muted">
                <Image alt={tEdit('fieldHeroImage')} className="object-cover" fill sizes="448px" src={brand.heroImageUrl} />
              </div>
            ) : <p className="text-sm text-muted-foreground">{t('notSet')}</p>}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{tEdit('fieldProductPhotos')}</h3>
            {brand.productPhotos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {brand.productPhotos.map((photo, index) => (
                  <div key={`${photo}-${index}`} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                    <Image alt={`${tEdit('fieldProductPhotos')} ${index + 1}`} className="object-cover" fill sizes="176px" src={photo} />
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">{t('notSet')}</p>}
          </div>
        </div>
      </OwnerSection>

      <OwnerSection editHref={`${editBase}2`} title={tEdit('wizardStepLinks')} editLabel={t('edit')}>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label={tEdit('fieldInstagram')} value={display(brand.socialInstagram, t('notSet'))} />
          <Field label={tEdit('fieldThreads')} value={display(brand.socialThreads, t('notSet'))} />
          <Field label={tEdit('fieldFacebook')} value={display(brand.socialFacebook, t('notSet'))} />
          <Field label={tEdit('fieldOfficialWebsite')} value={display(brand.purchaseWebsite, t('notSet'))} />
          <Field label="Pinkoi" value={display(brand.purchasePinkoi, t('notSet'))} />
          <Field label={tEdit('fieldShopee')} value={display(brand.purchaseShopee, t('notSet'))} />
          <Field
            label={tEdit('fieldOtherLinks')}
            value={brand.otherUrls.length > 0 ? brand.otherUrls.map(({ label, url }) => `${label}: ${url}`).join('\n') : t('notSet')}
            wide
          />
        </dl>
      </OwnerSection>

      <OwnerSection editHref={`${editBase}3`} title={tEdit('wizardStepLocations')} editLabel={t('edit')}>
        {brand.retailLocations.length > 0 ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {brand.retailLocations.map((location, index) => (
              <div key={`${location.name}-${index}`} className="rounded-lg bg-secondary p-4">
                <dt className="text-sm font-semibold text-foreground">{location.name}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{location.address || t('notSet')}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-sm text-muted-foreground">{t('notSet')}</p>}
      </OwnerSection>

      <OwnerSection editHref={`${editBase}4`} title={tEdit('wizardStepReputation')} editLabel={t('edit')}>
        <dl className="space-y-5">
          <Field label={tEdit('fieldReputationSummary')} value={display(brand.reputationSummary?.text, t('notSet'))} wide />
          <Field
            label={tEdit('fieldProvenanceSources')}
            value={brand.reputationSummary?.sources.length
              ? brand.reputationSummary.sources.map(({ url }) => url).join('\n')
              : t('notSet')}
            wide
          />
        </dl>
      </OwnerSection>
    </div>
  )
}
