import { describe, expect, it } from 'vitest'

import { routes } from '../routes'

describe('routes', () => {
  it('builds every public route from its parameters', () => {
    expect(routes.home()).toBe('/')
    expect(routes.brands()).toBe('/brands')
    expect(routes.brand('acme')).toBe('/brands/acme')
    expect(routes.categories()).toBe('/categories')
    expect(routes.category('home')).toBe('/categories/home')
    expect(routes.subcategory('home', 'furniture')).toBe('/categories/home/furniture')
    expect(routes.discover()).toBe('/discover')
    expect(routes.trail('small-space-reading-corner')).toBe(
      '/discover/small-space-reading-corner',
    )
    expect(routes.stories()).toBe('/stories')
    expect(routes.story('sample-story')).toBe('/stories/sample-story')
    expect(routes.events()).toBe('/events')
    expect(routes.event('taiwan-creative-expo')).toBe('/events/taiwan-creative-expo')
    expect(routes.whereToBuy()).toBe('/where-to-buy')
    expect(routes.whereToBuyCity('taipei')).toBe('/where-to-buy/taipei')
    expect(routes.about()).toBe('/about')
  })

  it('encodes parameters', () => {
    // A reserved character is escaped once, never twice: `%2F`, not `%252F`.
    expect(routes.brand('a/b')).toBe('/brands/a%2Fb')
    expect(routes.story('a b')).toBe('/stories/a%20b')
    expect(routes.category('a?b')).toBe('/categories/a%3Fb')
    expect(routes.subcategory('a#b', 'c&d')).toBe('/categories/a%23b/c%26d')
    expect(routes.brand('a/b')).not.toContain('%252F')
  })

  it('never emits a locale prefix', () => {
    // `@/i18n/navigation`'s `Link` owns prefixing. A prefix here double-prefixes.
    const every = [
      routes.home(),
      routes.brands(),
      routes.brand('acme'),
      routes.category('home'),
      routes.subcategory('home', 'furniture'),
      routes.discover(),
      routes.trail('x'),
      routes.stories(),
      routes.story('x'),
      routes.events(),
      routes.event('x'),
      routes.whereToBuy(),
      routes.whereToBuyCity('taipei'),
      routes.about(),
      routes.faq(),
      routes.submit.index(),
      routes.auth.signIn(),
      routes.admin.index(),
    ]

    for (const path of every) {
      expect(path.startsWith('/')).toBe(true)
      expect(path).not.toMatch(/^\/(zh-TW|en)(\/|$)/)
    }
  })

  it('appends a query string only for the keys that carry a value', () => {
    expect(routes.brands({ category: 'home' })).toBe('/brands?category=home')
    expect(routes.brands({ category: 'home', sub: null, search: undefined })).toBe(
      '/brands?category=home',
    )
    expect(routes.brands({})).toBe('/brands')
    expect(routes.brands()).toBe('/brands')
    expect(routes.submit.recommend({ name: '好 品牌' })).toBe(
      '/submit/recommend?name=%E5%A5%BD+%E5%93%81%E7%89%8C',
    )
  })

  it('builds the account, submit, auth and admin families', () => {
    expect(routes.favorites()).toBe('/favorites')
    expect(routes.settings()).toBe('/settings')
    expect(routes.submit.index()).toBe('/submit')
    expect(routes.submit.recommend()).toBe('/submit/recommend')
    expect(routes.submit.confirmation()).toBe('/submit/confirmation')

    expect(routes.auth.signIn()).toBe('/auth/sign-in')
    expect(routes.auth.signIn({ next: '/favorites' })).toBe(
      '/auth/sign-in?next=%2Ffavorites',
    )
    expect(routes.auth.signUp()).toBe('/auth/sign-up')
    expect(routes.auth.forgotPassword()).toBe('/auth/forgot-password')
    expect(routes.auth.resetPassword()).toBe('/auth/reset-password')
    expect(routes.auth.callback()).toBe('/auth/callback')

    expect(routes.admin.index()).toBe('/admin')
    expect(routes.admin.brands()).toBe('/admin/brands')
    expect(routes.admin.brands({ edit: 'brand-1' })).toBe('/admin/brands?edit=brand-1')
    expect(routes.admin.jobs()).toBe('/admin/jobs')
    expect(routes.admin.job('job-1')).toBe('/admin/jobs/job-1')
    expect(routes.admin.jobRunlog('job-1')).toBe('/admin/jobs/job-1/runlog')
    expect(routes.admin.submissions()).toBe('/admin/submissions')
    expect(routes.admin.moderation()).toBe('/admin/moderation')
    // The bucket key in `RATE_LIMIT_RULES`, not a documentation claim about one.
    expect(routes.admin.operations()).toBe('/admin/operations')
  })

  it('names the category path once whether or not a subcategory is present', () => {
    expect(routes.categoryPath('home')).toBe('/categories/home')
    expect(routes.categoryPath('home', null)).toBe('/categories/home')
    expect(routes.categoryPath('home', 'furniture')).toBe('/categories/home/furniture')
  })
})
