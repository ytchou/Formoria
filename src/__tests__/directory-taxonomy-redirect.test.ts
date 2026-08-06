import { describe, expect, it } from 'vitest'
import {
  decideDirectoryTaxonomyRedirect,
  isDirectoryIndexPath,
} from '@/proxy'

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
