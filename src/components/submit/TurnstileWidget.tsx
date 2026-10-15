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
  size?: TurnstileSize
}

type TurnstileSize = 'normal' | 'compact' | 'flexible'

// 'flexible' fills its container but has a 300px floor; 'compact' (150x140) is the
// only size that fits a narrower column without forcing horizontal scroll (WCAG 1.4.10).
const TURNSTILE_FLEXIBLE_MIN_WIDTH = 300

export function turnstileSizeFor(width: number): TurnstileSize {
  return width < TURNSTILE_FLEXIBLE_MIN_WIDTH ? 'compact' : 'flexible'
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
// Size is chosen once, from the container width at render time. Ceiling: a later resize
// (e.g. device rotation) does not re-render the widget, so it keeps its first size.
// Upgrade path: observe the container with a ResizeObserver and remove + re-render the
// widget when its width crosses TURNSTILE_FLEXIBLE_MIN_WIDTH.
function buildRenderOptions(
  siteKey: string,
  language: string,
  containerWidth: number,
  refs: CallbackRefs,
): TurnstileRenderOptions {
  return {
    size: turnstileSizeFor(containerWidth),
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
      buildRenderOptions(siteKey, language, containerRef.current.clientWidth, {
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
            buildRenderOptions(siteKey, language, containerRef.current.clientWidth, {
              onSuccess: onSuccessRef,
              onError: onErrorRef,
              onExpire: onExpireRef,
            }),
          )
        }}
      />
      <div ref={containerRef} className="w-full" />
    </>
  )
}
