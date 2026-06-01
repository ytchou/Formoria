import { createClient } from '@/lib/supabase/server'
import { getTags } from '@/lib/services/taxonomy'
import { SubmitWizard } from '@/components/submit/SubmitWizard'
import SubmitOverview from '@/components/submit/SubmitOverview'

export const metadata = {
  title: '提交品牌',
  description: '將您的台灣製造品牌分享給社群',
}

type SubmitPageProps = {
  params: Promise<{ locale: string }>
}

export default async function SubmitPage({ params }: SubmitPageProps) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return <SubmitOverview nextPath={locale === 'en' ? '/en/submit' : '/submit'} />
  }

  const categories = await getTags('product_type')

  return <SubmitWizard categories={categories} />
}
