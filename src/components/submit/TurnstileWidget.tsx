'use client'

import { useEffect, useRef, type RefObject } from 'react'
import Script from 'next/script'
import { useLocale } from 'next-intl'

type TurnstileRenderOptions = {
  sitekey: string
  callback: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  language?: string
}

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: TurnstileRenderOptions) => string
      remove: (widgetId: string) => void
    }
  }
}

type TurnstileWidgetProps = {
  onSuccess: (token: string) => void
  onError?: () => void
  onExpire?: () => void
}

type CallbackRefs = {
  onSuccess: RefObject<(token: string) => void>
  onError: RefObject<(() => void) | undefined>
  onExpire: RefObject<(() => void) | undefined>
}

// One options literal for both render paths (the effect, and Script onLoad on first load).
function buildRenderOptions(
  siteKey: string,
  language: string,
  refs: CallbackRefs,
): TurnstileRenderOptions {
  return {
    sitekey: siteKey,
    callback: (token: string) => refs.onSuccess.current(token),
    'error-callback': () => refs.onError.current?.(),
    'expired-callback': () => refs.onExpire.current?.(),
    theme: 'light',
    language,
  }
}

export function TurnstileWidget({ onSuccess, onError, onExpire }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  // Turnstile takes its own language codes; any non-English locale is the zh-TW site.
  const language = useLocale() === 'en' ? 'en' : 'zh-tw'

  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
    onExpireRef.current = onExpire
  })

  useEffect(() => {
    if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) return

    widgetIdRef.current = window.turnstile.render(
      containerRef.current,
      buildRenderOptions(siteKey, language, {
        onSuccess: onSuccessRef,
        onError: onErrorRef,
        onExpire: onExpireRef,
      }),
    )

    return () => {
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey, language])

  if (!siteKey) return null

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onError={() => onErrorRef.current?.()}
        onLoad={() => {
          if (!containerRef.current || !window.turnstile || widgetIdRef.current) return
          widgetIdRef.current = window.turnstile.render(
            containerRef.current,
            buildRenderOptions(siteKey, language, {
              onSuccess: onSuccessRef,
              onError: onErrorRef,
              onExpire: onExpireRef,
            }),
          )
        }}
      />
      <div ref={containerRef} />
    </>
  )
}
