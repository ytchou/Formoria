import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  absoluteImageUrl,
  imagePathToUrl,
  storagePathFromImageUrl,
} from '@/lib/images/image-url'

const SITE_URL = 'https://formoria.test'
const SUPABASE_URL = 'https://xkcayngbttpxyibgzern.supabase.co'
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/brand-images/`

describe('imagePathToUrl', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // DEV-1744 task 3 (the public-URL branch) is descoped — see the docblock on
  // `imagePathToUrl`. A public `brand-images` bucket has no per-prefix RLS, so
  // it would also expose `submissions/` for the whole upload-to-approval
  // window; confirmed live against staging 2026-09-17. Every prefix goes
  // through `/i/`, unchanged from pre-DEV-1744 behavior, until a separate
  // always-private bucket for `submissions/` ships as a follow-up.

  it('returns an /i/ URL for a brands/ key', () => {
    expect(
      imagePathToUrl('brands/11111111-2222-3333-4444-555555555555/x.webp'),
    ).toBe('/i/brands/11111111-2222-3333-4444-555555555555/x.webp')
  })

  it('returns an /i/ URL for curated-products/ and event-exhibitors/ keys', () => {
    expect(imagePathToUrl('curated-products/a/b/c.webp')).toBe(
      '/i/curated-products/a/b/c.webp',
    )
    expect(imagePathToUrl('event-exhibitors/2026-expo/booth-a1.webp')).toBe(
      '/i/event-exhibitors/2026-expo/booth-a1.webp',
    )
  })

  it('returns an /i/ URL for a submissions/ key', () => {
    // Pre-moderation content stays behind the proxy's deny-list.
    expect(imagePathToUrl('submissions/abc/x.webp')).toBe(
      '/i/submissions/abc/x.webp',
    )
  })

  it('returns an /i/ path regardless of whether the project URL is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(imagePathToUrl('brands/a/x.webp')).toBe('/i/brands/a/x.webp')
  })

  it('trims surrounding whitespace', () => {
    expect(imagePathToUrl('  brands/a/x.webp  ')).toBe('/i/brands/a/x.webp')
  })

  it('returns null for a blank path', () => {
    expect(imagePathToUrl(null)).toBeNull()
    expect(imagePathToUrl(undefined)).toBeNull()
    expect(imagePathToUrl('   ')).toBeNull()
  })

  it('refuses a value that is already a URL or an absolute path', () => {
    expect(imagePathToUrl('https://cdn.example/x.webp')).toBeNull()
    expect(imagePathToUrl('/i/brands/a/x.webp')).toBeNull()
  })
})

describe('absoluteImageUrl', () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = SITE_URL
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = previous
  })

  it('prefixes the site URL', () => {
    // A `submissions/` key, because that is the prefix `imagePathToUrl` still
    // renders as a relative proxy path after the DEV-1744 bucket flip — a
    // `brands/` key now comes back already absolute.
    expect(absoluteImageUrl(imagePathToUrl('submissions/a/x.webp'))).toBe(
      `${SITE_URL}/i/submissions/a/x.webp`,
    )
  })

  it('leaves an already-absolute URL alone', () => {
    expect(absoluteImageUrl('https://cdn.example/x.webp')).toBe(
      'https://cdn.example/x.webp',
    )
  })

  it('returns null for a blank value', () => {
    expect(absoluteImageUrl(null)).toBeNull()
    expect(absoluteImageUrl('')).toBeNull()
  })

  it('is idempotent, because JSON-LD callers pass mixed values', () => {
    const once = absoluteImageUrl('/i/brands/a/x.webp')
    expect(absoluteImageUrl(once)).toBe(once)
  })

  it('absolutises a path with no leading slash rather than passing it on', () => {
    // A relative IRI is what Google's structured-data parser drops.
    expect(absoluteImageUrl('images/formoria-mark.png')).toBe(
      `${SITE_URL}/images/formoria-mark.png`,
    )
  })

  it('leaves a non-http scheme and a protocol-relative URL alone', () => {
    expect(absoluteImageUrl('data:image/webp;base64,AAAA')).toBe(
      'data:image/webp;base64,AAAA',
    )
    expect(absoluteImageUrl('//cdn.example/x.webp')).toBe('//cdn.example/x.webp')
  })
})

describe('storagePathFromImageUrl', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips imagePathToUrl', () => {
    const path = 'brands/a/x.webp'
    expect(storagePathFromImageUrl(imagePathToUrl(path))).toBe(path)
  })

  it('returns null for anything that is not a proxy path', () => {
    expect(storagePathFromImageUrl('https://cdn.example/x.webp')).toBeNull()
    expect(storagePathFromImageUrl('/images/logo.png')).toBeNull()
    expect(storagePathFromImageUrl('/i/')).toBeNull()
  })

  it('recognizes a public Supabase storage URL for a brands/ key', () => {
    expect(storagePathFromImageUrl(`${PUBLIC_PREFIX}brands/x/y.webp`)).toBe(
      'brands/x/y.webp',
    )
  })

  it('still returns null for a signed URL', () => {
    // Signed URLs are out of scope on purpose: the key would have to be read
    // past a `/object/sign/` segment and a token query string, and every caller
    // of this function is a WRITE path — one of them deletes what it resolves.
    expect(
      storagePathFromImageUrl(
        `${SUPABASE_URL}/storage/v1/object/sign/brand-images/brands/x/y.webp?token=eyJhbGciOiJIUzI1NiJ9.fake.signature`,
      ),
    ).toBeNull()
  })

  it('returns null for a public URL outside brands/', () => {
    // The delete-path asymmetry (DEV-1374): `rejectBrandImages` deletes every
    // key this resolves, so a curated or submission object must not come back.
    expect(
      storagePathFromImageUrl(`${PUBLIC_PREFIX}curated-products/a/b/c.webp`),
    ).toBeNull()
    expect(
      storagePathFromImageUrl(`${PUBLIC_PREFIX}submissions/a/x.webp`),
    ).toBeNull()
  })

  it('returns null for a public URL on a foreign origin', () => {
    expect(
      storagePathFromImageUrl(
        'https://cdn.example.test/storage/v1/object/public/brand-images/brands/x/y.webp',
      ),
    ).toBeNull()
  })

  it('round-trips both URL forms', () => {
    const path = 'brands/a/x.webp'
    expect(storagePathFromImageUrl(imagePathToUrl(path))).toBe(path)
    expect(storagePathFromImageUrl(`${PUBLIC_PREFIX}${path}`)).toBe(path)
  })

  it('round-trips when the project URL has a trailing slash or padding', () => {
    // Both halves of the seam normalise the env value the same way, so neither
    // a trailing slash nor stray whitespace can desync build from parse.
    const path = 'brands/a/x.webp'
    for (const value of [`${SUPABASE_URL}/`, `  ${SUPABASE_URL}/  `]) {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', value)
      expect(storagePathFromImageUrl(imagePathToUrl(path))).toBe(path)
      expect(storagePathFromImageUrl(`${PUBLIC_PREFIX}${path}`)).toBe(path)
    }
  })
})
