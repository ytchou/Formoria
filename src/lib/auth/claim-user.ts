import { createClient } from '@/lib/supabase/server'

export async function requireClaimUser(): Promise<{
  id: string
  email: string | null
} | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return { id: user.id, email: user.email ?? null }
}
