import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  isAllowedImageHost,
  isNonImageHost,
  safeImageSrc,
  ALLOWED_IMAGE_HOSTS,
} from '@/lib/images/allowed-image-hosts'

/**
 * The list is computed once at module load, so a host-specific case has to
 * re-import the module with the project URL stubbed. The statically imported
 * binding above stays the unconfigured case, which is what vitest runs with.
 */
async function importWithProjectUrl(url: string) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url)
  vi.resetModules()
  return import('@/lib/images/allowed-image-hosts')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('isAllowedImageHost', () => {
  it('is empty when no Supabase project is configured', () => {
    // An unset project URL must not fall back to a wildcard: an empty list
    // rejects every remote host, which is the safe direction.
    expect(ALLOWED_IMAGE_HOSTS).toEqual([])
  })

  it('allows the configured project storage host (DEV-1744)', async () => {
    // The `brand-images` bucket is public again and `imagePathToUrl` addresses
    // published objects by their public storage URL, so `next/image` and
    // `safeImageSrc` both have to accept this host.
    const mod = await importWithProjectUrl('https://project.supabase.co')
    expect(mod.ALLOWED_IMAGE_HOSTS).toEqual(['project.supabase.co'])
    expect(mod.isAllowedImageHost('project.supabase.co')).toBe(true)
    expect(
      mod.safeImageSrc(
        'https://project.supabase.co/storage/v1/object/public/brand-images/brands/a/x.webp',
      ),
    ).toBe(
      'https://project.supabase.co/storage/v1/object/public/brand-images/brands/a/x.webp',
    )
  })

  it('stays host-exact: another Supabase project is not allowed', async () => {
    // A wildcard `*.supabase.co` would let any project on the internet render
    // inside our pages.
    const mod = await importWithProjectUrl('https://project.supabase.co')
    expect(mod.isAllowedImageHost('other.supabase.co')).toBe(false)
    expect(mod.isAllowedImageHost('project.supabase.co.evil.com')).toBe(false)
  })

  it('does not allow a Supabase host when none is configured', () => {
    expect(isAllowedImageHost('abc.supabase.co')).toBe(false)
    expect(isAllowedImageHost('project.storage.supabase.co')).toBe(false)
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
  it('rejects a public storage URL from an unconfigured/foreign project', () => {
    // Host-exact, not `*.supabase.co`: with no project configured (and with a
    // different project configured) these are somebody else's objects.
    expect(
      safeImageSrc('http://project.supabase.co/storage/v1/object/public/brand/logo.jpg'),
    ).toBeNull()
    expect(
      safeImageSrc('https://project.supabase.co/storage/v1/object/public/brand/logo.png'),
    ).toBeNull()
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
    expect(safeImageSrc('javascript:alert(1)')).toBeNull()
  })

  it('accepts a same-origin absolute path (the /i/ image proxy)', () => {
    const path = '/i/brands/2f1c9a4e-0000-4000-8000-000000000001/hero.webp'
    expect(safeImageSrc(path)).toBe(path)
  })

  it('accepts a repo-local asset path', () => {
    expect(safeImageSrc('/images/trails/small-space-reading-corner.webp')).toBe(
      '/images/trails/small-space-reading-corner.webp',
    )
  })

  it('rejects a protocol-relative path, which is not same-origin', () => {
    // `//evil.example/x.png` starts with `/`, so a naive leading-slash branch
    // hands the browser an offsite fetch. This is the whole reason the
    // same-origin branch lives inside safeImageSrc instead of at the callers.
    expect(safeImageSrc('//evil.example/x.png')).toBeNull()
    expect(safeImageSrc('///evil.example/x.png')).toBeNull()
    expect(safeImageSrc('/\\evil.example/x.png')).toBeNull()
  })

  it('still rejects a foreign host', () => {
    expect(safeImageSrc('https://evil.example/x.png')).toBeNull()
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
