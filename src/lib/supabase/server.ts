import 'server-only'
import { createServerClient } from '@supabase/ssr'
import type { NextResponse } from 'next/server'

type ResponseCookieTarget = Pick<NextResponse, 'cookies'>

export async function createClient(response?: ResponseCookieTarget) {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            if (response) {
              cookiesToSet.forEach(({ name, value, options }) =>
                response.cookies.set(name, value, options),
              )
            } else {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              )
            }
          } catch {
            // Server Component — can't set cookies
          }
        },
      },
    }
  )
}
