import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTags } from '@/lib/services/taxonomy'
import { SubmitWizard } from '@/components/submit/SubmitWizard'

export const metadata = {
  title: 'Submit Your Brand | MIT Map',
  description: 'Share your Made in Taiwan brand with the community',
}

export default async function SubmitPage() {
  // Auth gate
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Fetch taxonomy categories for the form
  const categories = await getTags('product_type')

  return <SubmitWizard categories={categories} />
}
