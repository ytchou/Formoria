import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { redirectIfAuthenticated } from '@/lib/auth/redirect-if-authenticated'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  return { title: locale === 'en' ? 'Forgot Password' : '忘記密碼' }
}

export default async function ForgotPasswordPage() {
  await redirectIfAuthenticated()
  return <ForgotPasswordForm />
}
