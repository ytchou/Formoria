import { createClient } from '@/lib/supabase/server'

export async function requireClaimUser(): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return { id: user.id }
}
