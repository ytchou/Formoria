import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'
import { L1_CATEGORIES } from '@/lib/taxonomy/ontology'
import {
  decideDirectoryTaxonomyRedirect,
  isDirectoryIndexPath,
} from '@/proxy'

/** A `next.config.ts` redirect row, flattened out of Next's permanent/statusCode union. */
type RedirectRule = {
  source: string
  destination: string
  permanent?: boolean
  statusCode?: number
}

async function configuredRedirects(): Promise<RedirectRule[]> {
  const rows = (await nextConfig.redirects?.()) ?? []
  return rows.map(row => ({
    source: row.source,
    destination: row.destination,
    permanent: (row as { permanent?: boolean }).permanent,
    statusCode: (row as { statusCode?: number }).statusCode,
  }))
}

function ruleFor(rules: RedirectRule[], source: string): RedirectRule | undefined {
  return rules.find(rule => rule.source === source)
}

describe('directory taxonomy redirects', () => {
  it('redirects a pure single-category state', () => {
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=home')).toEqual({
      action: 'redirect',
      status: 301,
      pathname: '/categories/home',
    })
  })

  it('redirects a pure category+sub state and preserves page', () => {
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=home&sub=furniture&page=2')).toEqual({
      action: 'redirect',
      status: 301,
      pathname: '/categories/home/furniture?page=2',
    })
  })

  it('preserves unrecognized query params while removing taxonomy params', () => {
    expect(decideDirectoryTaxonomyRedirect(
      '/brands',
      'category=home&sub=furniture&page=2&utm_source=newsletter',
    )).toEqual({
      action: 'redirect',
      status: 301,
      pathname: '/categories/home/furniture?page=2&utm_source=newsletter',
    })
  })

  it.each(['search=chairs', 'price=2', 'verification=owned', 'sort=name'])('does not redirect when %s is present', (query) => {
    expect(decideDirectoryTaxonomyRedirect('/brands', `category=home&${query}`).action).toBe('none')
  })

  it('does not redirect multi-valued category or sub', () => {
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=home,fashion').action).toBe('none')
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=home&sub=furniture,lighting').action).toBe('none')
  })

  it('does not redirect an invalid category or a wrong-parent sub', () => {
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=zzz').action).toBe('none')
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=home&sub=tops-and-tshirts')).toEqual({
      action: 'redirect',
      status: 301,
      pathname: '/categories/home',
    })
  })

  it('edge-cache predicate accepts bare category paths only', () => {
    expect(isDirectoryIndexPath('/categories/home')).toBe(true)
    expect(isDirectoryIndexPath('/categories/home/furniture')).toBe(true)
    expect(isDirectoryIndexPath('/categories/home', '?price=2')).toBe(false)
  })
})

/**
 * DEV-1510 split `kids-pets` into the live L1s `kids` and `pets`. The three
 * cases below pin the redirect table against the failure that split creates:
 * a retirement row left pointing at `/categories/kids-pets` makes a brand-new
 * L1 unreachable by URL, and the chain still answers 200 in local dev — the
 * loss only surfaces weeks later as a deindexed category in Search Console.
 *
 * `permanent: true` is what the config can express; Next serves it on the wire
 * as a 308, which is what `e2e/tests/public-routing-regressions.spec.ts`
 * asserts. Both are permanent redirects and both pass equity.
 */
describe('retired L1 taxonomy redirects', () => {
  it('pets_is_a_live_route_not_a_redirect', async () => {
    const rules = await configuredRedirects()

    // `pets` is an L1 the ontology owns, so /categories/pets renders.
    expect(L1_CATEGORIES.map(category => category.slug)).toContain('pets')
    expect(decideDirectoryTaxonomyRedirect('/brands', 'category=pets')).toEqual({
      action: 'redirect',
      status: 301,
      pathname: '/categories/pets',
    })

    // Generalised past `pets` deliberately: any redirect whose source is a live
    // L1 shadows a real page, and this loop is what catches the next split.
    const shadowed = rules
      .filter(rule =>
        L1_CATEGORIES.some(category =>
          [
            `/categories/${category.slug}`,
            `/en/categories/${category.slug}`,
            `/zh-TW/categories/${category.slug}`,
          ].includes(rule.source),
        ),
      )
      .map(rule => `${rule.source} -> ${rule.destination}`)
    expect(shadowed).toEqual([])

    // And nothing may hop through the retired parent on the way somewhere else.
    const chained = rules
      .filter(rule => rule.destination.endsWith('/categories/kids-pets'))
      .map(rule => `${rule.source} -> ${rule.destination}`)
    expect(chained).toEqual([])
  })

  it('baby_kids_redirects_to_kids', async () => {
    const rules = await configuredRedirects()

    expect(ruleFor(rules, '/categories/baby-kids')).toMatchObject({
      destination: '/categories/kids',
      permanent: true,
    })
    expect(ruleFor(rules, '/en/categories/baby-kids')).toMatchObject({
      destination: '/en/categories/kids',
      permanent: true,
    })
    expect(ruleFor(rules, '/zh-TW/categories/baby-kids')).toMatchObject({
      destination: '/categories/kids',
      permanent: true,
    })
  })

  it('kids_pets_redirects_to_brands', async () => {
    const rules = await configuredRedirects()

    // The merged L1 has no successor category — `kids` and `pets` each own half
    // of it — so the directory root is the closest surviving intent, exactly as
    // for the retired `others` bucket.
    expect(ruleFor(rules, '/categories/kids-pets')).toMatchObject({
      destination: '/brands',
      permanent: true,
    })
    expect(ruleFor(rules, '/en/categories/kids-pets')).toMatchObject({
      destination: '/en/brands',
      permanent: true,
    })
    expect(ruleFor(rules, '/zh-TW/categories/kids-pets')).toMatchObject({
      destination: '/brands',
      permanent: true,
    })
  })
})
