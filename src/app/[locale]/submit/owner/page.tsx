import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import { getUserBrand } from '@/lib/services/brand-owners'
import { Button } from '@/components/ui/button'
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
    const ownerPath = locale === 'en' ? '/en/submit/owner' : '/submit/owner'
    redirect(`/auth/sign-in?next=${ownerPath}`)
  }

  const hasOwnedBrand = Boolean(await getUserBrand(user.id))
  const shouldShowOwnedBrandNotice =
    requestedOwnedNotice && hasOwnedBrand && !hasAcknowledgedNotice

  const tSubmitConfirmation = await getTranslations('submit.confirmation')
  const submitOwnerPath =
    locale === 'en'
      ? '/en/submit/owner?ownershipNoticeAcknowledged=1'
      : '/submit/owner?ownershipNoticeAcknowledged=1'
  const submitPagePath = locale === 'en' ? '/en/submit' : '/submit'

  return (
    <div>
      {shouldShowOwnedBrandNotice ? (
        <div className="mx-auto max-w-2xl px-4 pt-8">
          <section
            aria-labelledby="owned-brand-notice-title"
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <h2
              id="owned-brand-notice-title"
              className="text-lg font-semibold text-foreground"
            >
              {tSubmitConfirmation('ownerSubheading')}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {tSubmitConfirmation('communityOwnershipNotice')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {tSubmitConfirmation('communityOwnershipContinue')}
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button asChild className="min-h-12">
                <Link href={submitOwnerPath}>
                  {tSubmitConfirmation('communityOwnershipContinueCta')}
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-12">
                <Link href={submitPagePath}>
                  {tSubmitConfirmation('communityOwnershipBackCta')}
                </Link>
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      <SubmitForm variant="owner" />
    </div>
  )
}
