import posthog from 'posthog-js'
import { isAppLocale } from '@/i18n/locale-preference'
import { registerPostHogProvider, registerPostHogSuperProperties } from './posthog-provider'
import { sanitizePostHogEvent } from './posthog-privacy'

type PostHogClient = {
  init(token: string, config: Record<string, unknown>): unknown
  capture(event: string, properties?: Record<string, unknown>): void
  identify(distinctId: string, setProperties?: Record<string, unknown>): void
  register(properties: Record<string, unknown>): void
  reset(): void
}

const MANAGED_POSTHOG_HOST = 'https://e.formoria.com'

export function initializePostHog(client: PostHogClient = posthog): boolean {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(/\/$/, '')
  const uiHost = process.env.NEXT_PUBLIC_POSTHOG_UI_HOST?.replace(/\/$/, '')

  if (
    process.env.NODE_ENV !== 'production'
    || !token
    || apiHost !== MANAGED_POSTHOG_HOST
    || uiHost !== 'https://us.posthog.com'
  ) {
    return false
  }

  client.init(token, {
    api_host: apiHost,
    ui_host: uiHost,
    defaults: '2026-05-30',
    capture_pageview: 'history_change',
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    disable_session_recording: true,
    disable_surveys: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    autocapture: {
      dom_event_allowlist: ['click', 'submit'],
      element_allowlist: ['a', 'button', 'form'],
      css_selector_ignorelist: [
        '.ph-no-autocapture',
        '[data-ph-no-autocapture]',
        '.ph-no-capture',
        '[data-ph-no-capture]',
        '[data-sensitive]',
        '[autocomplete="one-time-code"]',
      ],
      element_attribute_ignorelist: [
        'action',
        'aria-label',
        'data-email',
        'data-name',
        'data-phone',
        'href',
        'name',
        'value',
      ],
    },
    rageclick: false,
    // Suppress training/scraping crawlers that PostHog's own default blocklist
    // either misses or catches only by accident:
    // - `claudebot` is NOT in the default list. Today it is filtered only
    //   incidentally, because a generic `bot/` substring happens to match
    //   `ClaudeBot/1.0`. A UA format change would silently restore the traffic,
    //   so it is named explicitly here.
    // - The `*-User` assistant agents (`Claude-User`, `Perplexity-User`,
    //   `MistralAI-User`) are DELIBERATELY EXCLUDED. They represent a human
    //   asking an assistant to fetch a page, so they must be labelled, not
    //   suppressed.
    // Broader bot exclusion happens at query time via `$virt_is_bot = false`,
    // not here: blocking at capture destroys the very data that query-time
    // filtering would otherwise operate on.
    custom_blocked_useragents: [
      'claudebot',
      'claude-searchbot',
      'ccbot',
      'google-extended',
      'diffbot',
      'cohere-ai',
      'timpibot',
      'youbot',
    ],
    before_send: sanitizePostHogEvent,
  })
  const resolvedLocale = typeof document !== 'undefined'
    ? document.documentElement.lang
    : undefined
  if (isAppLocale(resolvedLocale)) {
    registerPostHogSuperProperties({ locale: resolvedLocale })
  }
  registerPostHogProvider(client)
  return true
}
