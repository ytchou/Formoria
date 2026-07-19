'use client'

import { useEffect, useRef } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
        }
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

type TurnstileWidgetProps = {
  onSuccess: (token: string) => void
  onError?: () => void
  onExpire?: () => void
}

export function TurnstileWidget({ onSuccess, onError, onExpire }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

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

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => onSuccessRef.current(token),
      'error-callback': () => onErrorRef.current?.(),
      'expired-callback': () => onExpireRef.current?.(),
      theme: 'light',
    })

    return () => {
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  if (!siteKey) return null

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onError={() => onErrorRef.current?.()}
        onLoad={() => {
          if (!containerRef.current || !window.turnstile || widgetIdRef.current) return
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token: string) => onSuccessRef.current(token),
            'error-callback': () => onErrorRef.current?.(),
            'expired-callback': () => onExpireRef.current?.(),
            theme: 'light',
          })
        }}
      />
      <div ref={containerRef} />
    </>
  )
}
