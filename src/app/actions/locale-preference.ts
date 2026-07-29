'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isRelativeUrl } from '@/lib/auth/validations'
import { updateProfile } from '@/lib/services/profiles'
import { isAppLocale, localizePath, LOCALE_COOKIE, type AppLocale } from '@/i18n/locale-preference'

export async function setLocalePreference(locale: AppLocale, formData: FormData) {
  if (!isAppLocale(locale)) return

  const requestedPath = formData.get('returnTo')
  const returnTo = typeof requestedPath === 'string' && isRelativeUrl(requestedPath)
    ? requestedPath
    : '/'

  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    sameSite: 'lax',
    httpOnly: false,
    // The CI server is production-mode but runs on plain HTTP localhost.
    secure: process.env.NODE_ENV === 'production' && process.env.PLAYWRIGHT_TEST !== 'true',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await updateProfile(user.id, { localePreference: locale })
  }

  redirect(localizePath(returnTo, locale))
}
