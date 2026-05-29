import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTags } from '@/lib/services/taxonomy'
import { SubmitWizard } from '@/components/submit/SubmitWizard'

export const metadata = {
  title: '提交品牌',
  description: '將您的台灣製造品牌分享給社群',
}

export default async function SubmitPage() {
  // Auth gate
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/auth/sign-in')
  }

  // Fetch taxonomy categories for the form
  const categories = await getTags('product_type')

  return <SubmitWizard categories={categories} />
}
