import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import type { AppLocale } from '@/i18n/locale-preference'

type FormPageProps = {
  params: Promise<{ locale: string }>
}

export default async function LegacySubmitFormPage({ params }: FormPageProps) {
  const { locale } = await params
  redirect(localizePath('/submit/recommend', locale as AppLocale))
}
