import type { Metadata } from 'next'
import { buildPrivatePageMetadata } from '@/lib/seo/private-page-metadata'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')
  return buildPrivatePageMetadata({
    locale,
    title: t('resetPassword.heading'),
    description: t('resetPassword.metaDescription'),
  })
}

export default async function ResetPasswordPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ResetPasswordForm />
}
