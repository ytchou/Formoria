import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { instagramAdapter } from './instagram'
import { shoplineAdapter } from './shopline'
import { ninetyOneAppAdapter } from './ninety-one-app'
import { cyberbizAdapter } from './cyberbiz'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../__tests__/fixtures', name), 'utf8')

describe('platform image adapters', () => {
  it('returns only Instagram post-grid photos and excludes a marked video poster', () => {
    const result = instagramAdapter.parse(
      fixture('instagram-grid.html'),
      'https://instagram.com/example',
    )
    expect(result.galleryImageUrls).toEqual([
      'https://cdninstagram.com/photo-one.jpg',
    ])
  })

  it.each([
    [
      shoplineAdapter,
      'shopline-products.html',
      'https://shoplineapp.com',
      'shopline_adapter',
    ],
    [
      ninetyOneAppAdapter,
      '91app-products.html',
      'https://91app.com',
      '91app_adapter',
    ],
    [
      cyberbizAdapter,
      'cyberbiz-products.html',
      'https://cyberbiz.co',
      'cyberbiz_adapter',
    ],
  ] as const)(
    'extracts scoped images with a 20-image adapter cap',
    (adapter, name, url, method) => {
      const result = adapter.parse(fixture(name), url)
      expect(result.galleryImageUrls).toHaveLength(1)
      expect(result.imageSources?.[0]?.method).toBe(method)
    },
  )

  it('Shopline adapter upgrades thumbnail query params', () => {
    const result = shoplineAdapter.parse(
      fixture('shopline-products.html'),
      'https://shoplineapp.com',
    )
    expect(result.galleryImageUrls[0]).not.toContain('?w=')
    expect(result.galleryImageUrls[0]).toBe(
      'https://img.shoplineapp.com/media/image_clips/one.jpg',
    )
  })

  it('91App adapter extracts product-card images from fixture', () => {
    const result = ninetyOneAppAdapter.parse(
      fixture('91app-products.html'),
      'https://91app.com',
    )
    expect(result.galleryImageUrls).toHaveLength(1)
    expect(result.galleryImageUrls[0]).toBe(
      'https://static.91app.com/images/one.jpg',
    )
  })

  it('resolves scoped relative product images without admitting page chrome', () => {
    const result = shoplineAdapter.parse(
      '<div data-product-id="one"><img src="/media/one.jpg"></div><header><img src="/logo.jpg"></header>',
      'https://store.shoplineapp.com/products/one',
    )
    expect(result.galleryImageUrls).toEqual([
      'https://store.shoplineapp.com/media/one.jpg',
    ])
  })
})
