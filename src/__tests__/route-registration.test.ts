import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLIC_INTL_SEGMENTS, RESERVED_ROUTES, SLUG_PATTERN } from '@/proxy'

/**
 * Adding a route directory under `src/app` without registering it in `proxy.ts`
 * is invisible in dev and in the `/en` prefix, but breaks the prefix-free
 * (zh-TW) URL in production — the brand-slug redirect swallows it. `/contact`
 * shipped that way. These tests read the filesystem so the next one can't.
 */

const APP_DIR = 'src/app'
const LOCALE_DIR = join(APP_DIR, '[locale]')

const isRouteGroup = (name: string) => name.startsWith('(')
const isDynamic = (name: string) => name.startsWith('[')

/**
 * First path segments the router can actually serve, flattening route groups
 * (which don't appear in URLs) and skipping dynamic segments.
 */
function topLevelSegments(dir: string): { name: string; path: string }[] {
  const segments: { name: string; path: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || isDynamic(entry.name)) continue
    const path = join(dir, entry.name)
    if (isRouteGroup(entry.name)) {
      segments.push(...topLevelSegments(path))
      continue
    }
    segments.push({ name: entry.name, path })
  }
  return segments
}

/**
 * Whether this segment serves an HTML page anywhere beneath it. Must recurse:
 * `auth/` holds no `page.tsx` of its own, only `auth/sign-in/page.tsx`, and a
 * shallow check would let exactly that shape escape the locale-inference guard.
 */
function servesAPage(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (servesAPage(join(dir, entry.name))) return true
    } else if (/^page\.tsx?$/.test(entry.name)) {
      return true
    }
  }
  return false
}

/**
 * Whether Next.js serves any URL under this segment. Excludes non-route
 * directories that live in `app/` for colocation only (e.g. `app/actions`).
 */
function isRoutable(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isRoutable(join(dir, entry.name))) return true
    } else if (/^(page|route)\.tsx?$/.test(entry.name)) {
      return true
    }
  }
  return false
}

describe('route registration', () => {
  const appSegments = [
    ...topLevelSegments(APP_DIR).filter((s) => s.name !== '[locale]'),
    ...topLevelSegments(LOCALE_DIR),
  ]

  it('finds the app routes it is meant to guard', () => {
    // Guards the guard: a bad glob would make every assertion below vacuous.
    expect(appSegments.length).toBeGreaterThan(5)
    expect(appSegments.map((s) => s.name)).toContain('contact')
  })

  it.each(appSegments.filter((s) => SLUG_PATTERN.test(s.name) && isRoutable(s.path)))(
    '/$name is reserved against the brand-slug redirect',
    ({ name }) => {
      expect(RESERVED_ROUTES.has(name)).toBe(true)
    },
  )

  it.each(topLevelSegments(LOCALE_DIR).filter((s) => servesAPage(s.path)))(
    '/$name is registered for locale inference',
    ({ name }) => {
      expect(PUBLIC_INTL_SEGMENTS.has(name)).toBe(true)
    },
  )
})
