import { redirect } from 'next/navigation'

type FormPageProps = {
  params: Promise<{ locale: string }>
}

export default async function LegacySubmitFormPage({ params }: FormPageProps) {
  const { locale } = await params
  redirect(locale === 'en' ? '/en/submit/recommend' : '/submit/recommend')
}
