import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { routes } from '@/lib/routes'

type FormPageProps = {
  params: Promise<{ locale: string }>
}

export default async function LegacySubmitFormPage({ params }: FormPageProps) {
  const { locale } = await params
  redirect(localizePath(routes.submit.recommend(), locale))
}
