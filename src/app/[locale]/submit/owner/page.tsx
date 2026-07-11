import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import type { AppLocale } from '@/i18n/locale-preference'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import { getUserBrand } from '@/lib/services/brand-owners'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import SubmitForm from '@/components/submit/SubmitForm'

type OwnerPageProps = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{
    ownedNotice?: string
    ownershipNoticeAcknowledged?: string
  }>
}

export async function generateMetadata({
  params,
}: OwnerPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.metadata')

  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates('/submit/owner', locale as Locale),
  }
}

export default async function SubmitOwnerPage({
  params,
  searchParams,
}: OwnerPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const resolvedSearchParams = await searchParams
  const requestedOwnedNotice = resolvedSearchParams?.ownedNotice === '1'
  const hasAcknowledgedNotice =
    resolvedSearchParams?.ownershipNoticeAcknowledged === '1'

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect(`/auth/sign-in?next=${localizePath('/submit/owner', locale as AppLocale)}`)
  }

  const hasOwnedBrand = Boolean(await getUserBrand(user.id))
  const shouldShowOwnedBrandNotice =
    requestedOwnedNotice && hasOwnedBrand && !hasAcknowledgedNotice

  const tSubmitConfirmation = await getTranslations('submit.confirmation')
  const submitOwnerPath = '/submit/owner?ownershipNoticeAcknowledged=1'
  const submitPagePath = '/submit'

  return (
    <div className="space-y-6">
      {shouldShowOwnedBrandNotice ? (
        <div className="page-gutter mx-auto max-w-2xl pt-8">
          <section
            aria-labelledby="owned-brand-notice-title"
            className={surfaceCardStyles({ elevated: true, padding: 'lg' })}
          >
            <h2
              id="owned-brand-notice-title"
              className="type-card-title"
            >
              {tSubmitConfirmation('ownerSubheading')}
            </h2>
            <p className="mt-3 type-card-description">
              {tSubmitConfirmation('communityOwnershipNotice')}
            </p>
            <p className="mt-2 type-card-description">
              {tSubmitConfirmation('communityOwnershipContinue')}
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Link
                href={submitOwnerPath}
                className={buttonVariants({ variant: 'primary' })}
              >
                {tSubmitConfirmation('communityOwnershipContinueCta')}
              </Link>
              <Link
                href={submitPagePath}
                className={buttonVariants({ variant: 'secondary' })}
              >
                {tSubmitConfirmation('communityOwnershipBackCta')}
              </Link>
            </div>
          </section>
        </div>
      ) : null}

      <SubmitForm variant="owner" />
    </div>
  )
}
