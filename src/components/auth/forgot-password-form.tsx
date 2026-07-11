'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { resetPassword } from '@/app/auth/actions'
import type { AuthState } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(resetPassword, {})
  const t = useTranslations('auth')

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section-title-large">{t('forgotPassword.heading')}</h1>
        <p className="type-card-description">{t('forgotPassword.subheading')}</p>
      </div>

      {state.error && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      {state.message ? (
        <div className="rounded-lg bg-verified-green-bg px-4 py-3 text-sm text-verified-green">
          {state.message}
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('forgotPassword.emailLabel')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <Button type="submit" className="w-full" size="large" disabled={pending}>
            {pending ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
          </Button>
        </form>
      )}

      <p className="text-center type-card-description">
        {t('forgotPassword.backToSignIn')}{' '}
        <Link
          href="/auth/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t('forgotPassword.signInLink')}
        </Link>
      </p>
    </div>
  )
}
