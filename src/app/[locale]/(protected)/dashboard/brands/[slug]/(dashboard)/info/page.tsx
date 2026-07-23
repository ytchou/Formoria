import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { InfoField } from '@/components/ui/card'
import { getProductTypeLabel } from '@/lib/brands/category-label'
import { getBrandBySlug } from '@/lib/services/brands'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

function EmptyValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

function display(
  value: string | number | null | undefined,
  fallback: string,
) {
  return value === null || value === undefined || value === ''
    ? <EmptyValue>{fallback}</EmptyValue>
    : String(value)
}

export default async function InfoPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const [t, tEdit] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard.brandProfile' }),
    getTranslations({ locale, namespace: 'dashboard.edit' }),
  ])
  const priceRange = brand.priceRange
    ? tEdit(
        brand.priceRange === 1
          ? 'fieldPriceRangeBudget'
          : brand.priceRange === 2
            ? 'fieldPriceRangeMidRange'
            : 'fieldPriceRangePremium',
      )
    : <EmptyValue>{t('notSet')}</EmptyValue>

  return (
    <SectionDetailLayout
      description={t('sectionBasicInfoHint')}
      editHref={`/dashboard/brands/${slug}/edit?step=0`}
      editLabel={t('edit')}
      title={tEdit('wizardStepBasicInfo')}
    >
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <InfoField
          label={tEdit('fieldBrandName')}
          value={display(brand.name, t('notSet'))}
        />
        <InfoField
          label={tEdit('fieldProductType')}
          value={
            brand.productType
              ? (
                  getProductTypeLabel(
                    brand.productType,
                    locale === 'zh-TW' ? 'zh-TW' : 'en',
                  ) ?? brand.productType
                )
              : <EmptyValue>{t('notSet')}</EmptyValue>
          }
        />
        <InfoField
          label={tEdit('fieldDescription')}
          value={display(brand.description, t('notSet'))}
          wide
        />
        <InfoField
          label={tEdit('fieldFoundingYear')}
          value={display(brand.foundingYear, t('notSet'))}
        />
        <InfoField
          label={tEdit('city')}
          value={display(brand.city, t('notSet'))}
        />
        <InfoField
          label={tEdit('fieldPriceRange')}
          value={priceRange}
        />
        <InfoField
          label={tEdit('fieldProductTags')}
          value={
            brand.productTags.length > 0
              ? brand.productTags.join(' · ')
              : <EmptyValue>{t('notSet')}</EmptyValue>
          }
        />
        <InfoField
          label={tEdit('mitStoryLabel')}
          value={display(brand.mitStory, t('notSet'))}
          wide
        />
      </dl>
    </SectionDetailLayout>
  )
}
