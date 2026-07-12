import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth')
  return {
    title: t('resetPassword.heading'),
    robots: { index: false, follow: true },
  }
}

export default function ResetPasswordPage() {
  return <ResetPasswordForm />
}
