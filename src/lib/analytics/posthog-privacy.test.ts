// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  isPostHogAnalyticsPath,
  sanitizePostHogEvent,
  sanitizePostHogUrl,
} from './posthog-privacy'

describe('PostHog path privacy', () => {
  it.each([
    '/admin',
    '/zh-TW/admin/brands',
    '/auth/callback?code=secret',
    '/en/challenge',
    '/api/search?q=private',
    '/_next/static/chunk.js',
  ])('rejects protected path %s', (pathname) => {
    expect(isPostHogAnalyticsPath(pathname)).toBe(false)
  })

  it.each(['/', '/zh-TW/brands', '/en/brands/example', '/zh-TW/dashboard']) (
    'accepts customer-facing path %s',
    (pathname) => {
      expect(isPostHogAnalyticsPath(pathname)).toBe(true)
    },
  )

  it('keeps only approved UTM parameters and removes hashes', () => {
    expect(
      sanitizePostHogUrl(
        'https://formoria.com/zh-TW/brands?search=private&utm_source=threads&utm_medium=social&utm_campaign=person@example.com&code=secret#email',
      ),
    ).toBe('https://formoria.com/zh-TW/brands?utm_source=threads&utm_medium=social')
    expect(
      sanitizePostHogUrl('https://referrer.example/private/path?email=person@example.com'),
    ).toBe('https://referrer.example/')
    expect(sanitizePostHogUrl('https://%')).toBe('https://formoria.com/')
  })

  it('drops protected events and direct identifiers before send', () => {
    expect(
      sanitizePostHogEvent({
        event: '$pageview',
        properties: { $current_url: 'https://formoria.com/auth/callback?code=secret' },
      }),
    ).toBeNull()

    expect(
      sanitizePostHogEvent({
        event: 'search_executed',
        properties: {
          $current_url: 'https://formoria.com/en/brands?search=private&utm_campaign=launch',
          query: 'private',
          search_term: 'private',
          email: 'person@example.com',
          user_email: 'another@example.com',
          full_name: 'Private Person',
          phone_number: '0912345678',
          form_data: { proposal: 'Private proposal' },
          $elements: [{ text: 'Private Person', attr__href: '/brands?email=person@example.com' }],
          authorization: 'Bearer secret',
          query_length: 7,
        },
      }),
    ).toEqual({
      event: 'search_executed',
      properties: expect.objectContaining({
        $current_url: 'https://formoria.com/en/brands?utm_campaign=launch',
        query_length: 7,
        analytics_schema_version: 1,
        environment: 'production',
        locale: 'en',
        content_group: 'directory',
        surface: 'public',
      }),
    })
    const serialized = JSON.stringify(sanitizePostHogEvent({
      event: 'custom',
      properties: {
        $current_url: 'https://formoria.com/',
        user_email: 'another@example.com',
        full_name: 'Private Person',
        phone_number: '0912345678',
        form_data: { proposal: 'Private proposal' },
        authorization: 'Bearer secret',
      },
    }))
    expect(serialized).not.toContain('another@example.com')
    expect(serialized).not.toContain('Private Person')
    expect(serialized).not.toContain('0912345678')
    expect(serialized).not.toContain('Private proposal')
    expect(serialized).not.toContain('Bearer secret')
    expect(serialized).not.toContain('person@example.com')
  })

  it('removes nested autocapture text and attributes', () => {
    const sanitized = sanitizePostHogEvent({
      event: '$autocapture',
      properties: {
        $current_url: 'https://formoria.com/en/brands',
        $elements: [{
          tag_name: 'a',
          text: 'Private Person',
          attr__href: '/brands?email=private@example.com',
          attributes: { value: 'private@example.com' },
        }],
      },
    })

    const serialized = JSON.stringify(sanitized)
    expect(serialized).toContain('tag_name')
    expect(serialized).not.toContain('Private Person')
    expect(serialized).not.toContain('private@example.com')
  })

  it('drops unsafe UTM property values while preserving campaign tokens', () => {
    const sanitized = sanitizePostHogEvent({
      event: 'user_signed_up',
      properties: {
        $current_url: 'https://formoria.com/en/dashboard',
        $utm_source: 'person@example.com',
        utm_medium: 'paid_social',
        utm_campaign: 'launch-2026',
      },
    })

    expect(sanitized?.properties).not.toHaveProperty('$utm_source')
    expect(sanitized?.properties).toMatchObject({
      utm_medium: 'paid_social',
      utm_campaign: 'launch-2026',
    })
  })
})
