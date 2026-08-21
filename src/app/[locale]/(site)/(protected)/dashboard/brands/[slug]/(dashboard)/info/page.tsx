import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { EmptyValue, display } from '@/components/dashboard/display-helpers'
import { InfoField } from '@/components/ui/card'
import {
  getBrandSubcategoryLabels,
  getCategoryLabel,
} from '@/lib/brands/category-label'
import { getBrandBySlug } from '@/lib/services/brands'
import { routes } from '@/lib/routes'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function InfoPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const [t, tEdit] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard.brandProfile' }),
    getTranslations({ locale, namespace: 'dashboard.edit' }),
  ])
  // `subcategories` stores slugs since DEV-1510; the owner reads labels.
  const subcategoryLabels = getBrandSubcategoryLabels(brand, locale)
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
      editHref={`${routes.dashboard.brandEdit(slug)}?step=0`}
      editLabel={t('edit')}
      title={tEdit('wizardStepBasicInfo')}
    >
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <InfoField
          label={tEdit('fieldBrandName')}
          value={display(brand.name, t('notSet'))}
        />
        <InfoField
          label={tEdit('fieldCategory')}
          value={
            brand.categorySlug
              ? (
                  getCategoryLabel(
                    brand.categorySlug,
                    locale === 'zh-TW' ? 'zh-TW' : 'en',
                  ) ?? brand.categorySlug
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
          label={tEdit('fieldSubcategories')}
          value={
            subcategoryLabels.length > 0
              ? subcategoryLabels.join(' · ')
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
