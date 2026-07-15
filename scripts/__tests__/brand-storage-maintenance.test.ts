import { describe, expect, it } from 'vitest'

import { categorizeObjects } from '../brand-storage-maintenance'

const refs = {
  activePaths: new Set(['brands/b1/live.webp', 'submissions/s1/hero.png']),
  rejectedPaths: new Set(['brands/b1/junk.jpg']),
  otherReferencedPaths: new Set(['brands/b1/draft-ref.jpg']),
  soakProtectedPaths: new Set(['brands/b1/old-original.jpg']),
}

describe('categorizeObjects', () => {
  it('categorizes bucket objects into live / rejected / untracked / protected', () => {
    const objects = [
      { path: 'brands/b1/live.webp', size: 100 },
      { path: 'submissions/s1/hero.png', size: 100 },
      { path: 'brands/b1/junk.jpg', size: 200 },
      { path: 'brands/b1/nobody-knows.bin', size: 300 },
      { path: 'index.html', size: 10 },
      { path: 'brands/b1/draft-ref.jpg', size: 50 },
      { path: 'brands/b1/old-original.jpg', size: 400 },
    ]

    const result = categorizeObjects(objects, refs)

    expect(result.live.map((object) => object.path)).toEqual([
      'brands/b1/live.webp',
      'submissions/s1/hero.png',
    ])
    expect(result.rejected.map((object) => object.path)).toEqual([
      'brands/b1/junk.jpg',
    ])
    expect(result.untracked.map((object) => object.path)).toEqual([
      'brands/b1/nobody-knows.bin',
      'index.html',
    ])
    expect(result.protected.map((object) => object.path)).toEqual(
      expect.arrayContaining([
        'brands/b1/draft-ref.jpg',
        'brands/b1/old-original.jpg',
      ]),
    )
  })

  it('a rejected path that is also referenced elsewhere is an anomaly, never deletable', () => {
    const path = 'brands/b1/rejected-but-hero.jpg'
    const result = categorizeObjects([{ path, size: 1 }], {
      ...refs,
      rejectedPaths: new Set([path]),
      otherReferencedPaths: new Set([path]),
    })

    expect(result.anomalies.map((object) => object.path)).toEqual([path])
    expect(result.rejected).toEqual([])
  })
})
