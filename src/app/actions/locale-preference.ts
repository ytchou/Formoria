'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updateProfile } from '@/lib/services/profiles'
import { isAppLocale, localizePath, LOCALE_COOKIE, type AppLocale } from '@/i18n/locale-preference'

export async function setLocalePreference(locale: AppLocale, pathname: string) {
  if (!isAppLocale(locale)) return

  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await updateProfile(user.id, { localePreference: locale })
  }

  redirect(localizePath(pathname, locale))
}
