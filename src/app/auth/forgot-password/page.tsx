import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { redirectIfAuthenticated } from '@/lib/auth/redirect-if-authenticated'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth')
  return {
    title: t('forgotPassword.heading'),
    robots: { index: false, follow: true },
  }
}

export default async function ForgotPasswordPage() {
  await redirectIfAuthenticated()
  return <ForgotPasswordForm />
}
