import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirectIfAuthenticated } from '@/lib/auth/redirect-if-authenticated'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')
  return {
    title: t('forgotPassword.heading'),
    robots: { index: false, follow: true },
  }
}

export default async function ForgotPasswordPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  await redirectIfAuthenticated()
  return <ForgotPasswordForm />
}
