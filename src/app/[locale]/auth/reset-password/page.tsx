import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')
  return {
    title: t('resetPassword.heading'),
    robots: { index: false, follow: true },
  }
}

export default async function ResetPasswordPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ResetPasswordForm />
}
