import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ContributionsList } from '@/components/contributions/contributions-list'
import { localizePath } from '@/i18n/locale-preference'
import { listMyEvidence } from '@/lib/services/origin-evidence'
import { createClient } from '@/lib/supabase/server'

type ContributionsPageProps = {
  params: Promise<{ locale: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: ContributionsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contributions')

  return {
    title: t('metadata.title'),
    description: t('subheading'),
    robots: { index: false, follow: true },
  }
}

export default async function ContributionsPage({ params }: ContributionsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contributions')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(localizePath('/auth/sign-in', locale))
  }

  const items = await listMyEvidence(user.id)

  return (
    <main className="page-gutter mx-auto max-w-3xl py-12">
      <h1 className="type-page-title-large">{t('heading')}</h1>
      <p className="mt-2 type-body-muted">{t('subheading')}</p>
      <div className="mt-8">
        <ContributionsList items={items} />
      </div>
    </main>
  )
}
