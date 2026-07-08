import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import SubmitForm from '@/components/submit/SubmitForm'
import { getUserBrand } from '@/lib/services/brand-owners'

type OwnerPageProps = {
  params: Promise<{ locale: string }>
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

export default async function SubmitOwnerPage({ params }: OwnerPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    const ownerPath = locale === 'en' ? '/en/submit/owner' : '/submit/owner'
    redirect(`/auth/sign-in?next=${ownerPath}`)
  }

  return <SubmitForm variant="owner" hasOwnedBrand={Boolean(await getUserBrand(user.id))} />
}
