import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { routes } from '@/lib/routes'

type SubmitPageProps = {
  params: Promise<{ locale: string }>
}

// The hub held one card whose only action led to the recommend form (DEV-1988,
// SP2-05), so the step is skipped. Its bullets and the brand-owner line now sit
// above the form itself. Same redirect as the legacy /submit/form route.
export default async function SubmitPage({ params }: SubmitPageProps) {
  const { locale } = await params
  redirect(localizePath(routes.submit.recommend(), locale))
}
