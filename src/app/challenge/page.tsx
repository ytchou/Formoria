'use client'

import { Suspense, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TurnstileWidget } from '@/components/submit/TurnstileWidget'

type ChallengeState = 'idle' | 'verifying' | 'error'

function ChallengeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo') ?? '/'
  const [state, setState] = useState<ChallengeState>('idle')

  const handleSuccess = useCallback(
    async (token: string) => {
      setState('verifying')

      try {
        const response = await fetch('/api/challenge/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token, returnTo }),
        })

        if (!response.ok) {
          setState('error')
          return
        }

        const data = (await response.json()) as { redirectTo?: string }
        router.push(data.redirectTo ?? '/')
      } catch {
        setState('error')
      }
    },
    [returnTo, router]
  )

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: 'var(--background)',
        color: 'var(--foreground)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '420px',
          textAlign: 'center',
          padding: '32px',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          background: 'var(--card)',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
        }}
      >
        <h1 style={{ margin: '0 0 12px', fontSize: '24px', lineHeight: 1.25 }}>
          Quick verification
        </h1>
        <p style={{ margin: '0 0 24px', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
          Please complete the check to continue browsing.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', minHeight: '65px' }}>
          <TurnstileWidget onSuccess={handleSuccess} onError={() => setState('error')} />
        </div>
        {state === 'verifying' ? (
          <p style={{ margin: '20px 0 0', color: 'var(--muted-foreground)' }}>Verifying…</p>
        ) : null}
        {state === 'error' ? (
          <p style={{ margin: '20px 0 0', color: 'var(--destructive)' }}>
            Verification failed. Please try again.
          </p>
        ) : null}
      </section>
    </main>
  )
}

export default function ChallengePage() {
  return (
    <Suspense fallback={null}>
      <ChallengeContent />
    </Suspense>
  )
}
