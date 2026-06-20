import { describe, it, expect } from 'vitest'
import {
  isAllowedImageHost,
  isNonImageHost,
  safeImageSrc,
  ALLOWED_IMAGE_HOSTS,
} from '@/lib/images/allowed-image-hosts'

describe('isAllowedImageHost', () => {
  it('contains only the Supabase wildcard', () => {
    expect(ALLOWED_IMAGE_HOSTS).toEqual(['*.supabase.co'])
  })

  it('matches wildcard hosts at any subdomain depth', () => {
    expect(isAllowedImageHost('abc.supabase.co')).toBe(true)
    expect(isAllowedImageHost('project.storage.supabase.co')).toBe(true)
  })

  it('rejects previously-allowed external hosts', () => {
    expect(isAllowedImageHost('cdn01.pinkoi.com')).toBe(false)
    expect(isAllowedImageHost('cdn02.pinkoi.com')).toBe(false)
    expect(isAllowedImageHost('img.shoplineapp.com')).toBe(false)
    expect(isAllowedImageHost('1973home.myshopify.com')).toBe(false)
    expect(isAllowedImageHost('shoplineimg.com')).toBe(false)
  })

  it('rejects non-allowlisted hosts', () => {
    expect(isAllowedImageHost('www.facebook.com')).toBe(false)
    expect(isAllowedImageHost('static.wixstatic.com')).toBe(false)
    expect(isAllowedImageHost('supabase.co.evil.com')).toBe(false)
  })
})

describe('safeImageSrc', () => {
  it('upgrades http to https for allowed hosts (next/image is https-only)', () => {
    expect(
      safeImageSrc('http://project.supabase.co/storage/v1/object/public/brand/logo.jpg'),
    ).toBe('https://project.supabase.co/storage/v1/object/public/brand/logo.jpg')
  })

  it('returns https URLs on allowed hosts unchanged', () => {
    expect(
      safeImageSrc('https://project.supabase.co/storage/v1/object/public/brand/logo.png'),
    ).toBe('https://project.supabase.co/storage/v1/object/public/brand/logo.png')
  })

  it('returns null for external CDN URLs (post-migration)', () => {
    expect(safeImageSrc('https://cdn01.pinkoi.com/product/image.jpg')).toBeNull()
    expect(safeImageSrc('https://img.shoplineapp.com/media/image.webp')).toBeNull()
  })

  it('returns null for non-allowlisted hosts (e.g. tracking pixels)', () => {
    expect(
      safeImageSrc('https://www.facebook.com/tr?id=123&ev=PageView&noscript=1'),
    ).toBeNull()
    expect(safeImageSrc('https://tr.line.me/tag.gif?x=1')).toBeNull()
  })

  it('returns null for invalid, empty, or non-http(s) URLs', () => {
    expect(safeImageSrc(null)).toBeNull()
    expect(safeImageSrc(undefined)).toBeNull()
    expect(safeImageSrc('')).toBeNull()
    expect(safeImageSrc('not a url')).toBeNull()
    expect(safeImageSrc('data:image/png;base64,iVBOR')).toBeNull()
  })
})

describe('isNonImageHost', () => {
  it('flags Facebook tracking-pixel hosts', () => {
    expect(
      isNonImageHost(
        'https://www.facebook.com/tr?id=112344346178092&ev=PageView&noscript=1',
      ),
    ).toBe(true)
    expect(isNonImageHost('https://facebook.com/anything')).toBe(true)
  })

  it('flags LINE tracking and link hosts (host-based, any path)', () => {
    expect(isNonImageHost('https://tr.line.me/tag.gif?c_t=lap&e=pv')).toBe(true)
    expect(isNonImageHost('https://page.line.me/hellome?openQrModal=true')).toBe(
      true,
    )
  })

  it('flags Instagram profile hosts', () => {
    expect(isNonImageHost('https://www.instagram.com/brand_name')).toBe(true)
    expect(isNonImageHost('https://instagram.com/brand_name')).toBe(true)
  })

  it('flags Instagram CDN hosts (URLs expire)', () => {
    expect(
      isNonImageHost('https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-15/image.jpg'),
    ).toBe(true)
    expect(isNonImageHost('https://scontent.cdninstagram.com/v/image.jpg')).toBe(
      true,
    )
  })

  it('allows real image CDNs (even those not in ALLOWED_IMAGE_HOSTS)', () => {
    expect(isNonImageHost('https://cdn01.pinkoi.com/product/x/1/800x0.jpg')).toBe(
      false,
    )
    expect(isNonImageHost('https://static.wixstatic.com/media/abc.png')).toBe(
      false,
    )
    expect(
      isNonImageHost(
        'https://project.supabase.co/storage/v1/object/public/brand/x.webp',
      ),
    ).toBe(false)
  })

  it('returns false for malformed / non-URL input (never throws)', () => {
    expect(isNonImageHost('')).toBe(false)
    expect(isNonImageHost('not a url')).toBe(false)
  })
})
