import { describe, expect, it } from 'vitest'

import {
  BRAND_IMAGES_BUCKET,
  BRAND_SUBMISSIONS_BUCKET,
  partitionImageStoragePaths,
  resolveImageStorageLocation,
} from '@/lib/images/storage-keys'

describe('resolveImageStorageLocation', () => {
  it.each([
    ['brands/atelier/hero.webp', BRAND_IMAGES_BUCKET, 'public'],
    ['curated-products/atelier/cup/hero.webp', BRAND_IMAGES_BUCKET, 'public'],
    ['event-exhibitors/expo/booth-a1.webp', BRAND_IMAGES_BUCKET, 'public'],
    ['events/expo/hero.webp', BRAND_IMAGES_BUCKET, 'public'],
    [
      'submissions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/hero.webp',
      BRAND_SUBMISSIONS_BUCKET,
      'private',
    ],
  ] as const)('routes %s to %s', (path, bucket, visibility) => {
    expect(resolveImageStorageLocation(path)).toEqual({ bucket, visibility })
  })

  it.each([
    '',
    'unknown/hero.webp',
    '/brands/hero.webp',
    'brands/../submissions/hero.webp',
  ])('rejects an unowned or unsafe key: %s', (path) => {
    expect(resolveImageStorageLocation(path)).toBeNull()
  })
})

describe('partitionImageStoragePaths', () => {
  it('partitions mixed cleanup keys by their owning bucket and rejects unknown keys', () => {
    expect(
      partitionImageStoragePaths([
        'brands/atelier/hero.webp',
        'submissions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/hero.webp',
        'brands/atelier/hero.webp',
        'unowned/hero.webp',
      ]),
    ).toEqual({
      [BRAND_IMAGES_BUCKET]: ['brands/atelier/hero.webp'],
      [BRAND_SUBMISSIONS_BUCKET]: [
        'submissions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/hero.webp',
      ],
      rejected: ['unowned/hero.webp'],
    })
  })
})
