import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  config,
  decideBareBrandSlug,
  isOutsideAppRoutes,
  PUBLIC_INTL_SEGMENTS,
  RESERVED_ROUTES,
  SLUG_PATTERN,
} from '@/proxy'

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

/**
 * The URLs Next.js serves for the files directly in `src/app`. An image
 * generator (`opengraph-image.tsx`) is served at its bare stem. Every other
 * root file is served under a name with an extension (`icon.png`, `sitemap.ts`
 * as `/sitemap.xml`), and other source files serve nothing.
 */
const IMAGE_GENERATOR_STEM = /^(icon|apple-icon|opengraph-image|twitter-image)\d*$/

function rootFileRoutes(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .flatMap(({ name }) => {
      const source = /^(.+)\.[jt]sx?$/.exec(name)
      if (!source) return [`/${name}`]
      return IMAGE_GENERATOR_STEM.test(source[1]) ? [`/${source[1]}`] : []
    })
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

  it('lets Next.js handle its Webpack HMR endpoint while guarding ordinary routes', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)

    expect(matcher.test('/_next/webpack-hmr')).toBe(false)
    expect(matcher.test('/en/brands')).toBe(true)
  })

  it('404s an absent bare slug but redirects an approved one', () => {
    expect(decideBareBrandSlug('missing-brand', false)).toEqual({
      action: 'not-found',
      status: 404,
    })
    expect(decideBareBrandSlug('existing-brand', true)).toEqual({
      action: 'redirect',
      status: 301,
      pathname: '/brands/existing-brand',
    })
  })

  it('keeps getting-started retired without releasing its brand slug', () => {
    const segment = appSegments.find(({ name }) => name === 'getting-started')
    expect(segment ? isRoutable(segment.path) : false).toBe(false)
    expect(PUBLIC_INTL_SEGMENTS.has('getting-started')).toBe(false)
    expect(RESERVED_ROUTES.has('getting-started')).toBe(true)
  })

  it('keeps vision retired without releasing its brand slug', () => {
    const segment = appSegments.find(({ name }) => name === 'vision')
    expect(segment ? isRoutable(segment.path) : false).toBe(false)
    expect(PUBLIC_INTL_SEGMENTS.has('vision')).toBe(false)
    expect(RESERVED_ROUTES.has('vision')).toBe(true)
  })

  it.each(appSegments.filter((s) => SLUG_PATTERN.test(s.name) && isRoutable(s.path)))(
    '/$name is reserved against the brand-slug redirect',
    ({ name }) => {
      expect(RESERVED_ROUTES.has(name)).toBe(true)
    },
  )

  it.each(appSegments.filter((s) => isRoutable(s.path)))(
    '/$name/... is not rewritten to the not-found page by the proxy',
    ({ name }) => {
      expect(isOutsideAppRoutes(`/${name}/x`)).toBe(false)
    },
  )

  it.each(rootFileRoutes())('%s is not rewritten to the not-found page by the proxy', (route) => {
    expect(isOutsideAppRoutes(route)).toBe(false)
  })

  it.each(readdirSync('public', { withFileTypes: true }))(
    'public/$name is not rewritten to the not-found page by the proxy',
    (entry) => {
      const route = entry.isDirectory() ? `/${entry.name}/x` : `/${entry.name}`
      expect(isOutsideAppRoutes(route)).toBe(false)
    },
  )

  it.each(topLevelSegments(LOCALE_DIR).filter((s) => servesAPage(s.path)))(
    '/$name is registered for locale inference',
    ({ name }) => {
      expect(PUBLIC_INTL_SEGMENTS.has(name)).toBe(true)
    },
  )
})
