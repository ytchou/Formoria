import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { createClient } from '@/lib/supabase/server'
import { getTags } from '@/lib/services/taxonomy'
import { SubmitWizard } from '@/components/submit/SubmitWizard'

type FormPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: FormPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.metadata')
  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates('/submit/form', locale as Locale),
  }
}

export default async function SubmitFormPage({ params }: FormPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    const formPath = locale === 'en' ? '/en/submit/form' : '/submit/form'
    redirect(`/auth/sign-in?next=${formPath}`)
  }

  const [regionTags, valueTags] = await Promise.all([
    getTags('region'),
    getTags('value'),
  ])

  return (
    <SubmitWizard
      regionTags={regionTags}
      valueTags={valueTags}
    />
  )
}
