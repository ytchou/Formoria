import { describe, expect, it } from 'vitest'

import {
  categorizeObjects,
  planPurge,
  shouldReencode,
} from '../brand-storage-maintenance'

const refs = {
  activePaths: new Set(['brands/b1/live.webp', 'submissions/s1/hero.png']),
  rejectedPaths: new Set(['brands/b1/junk.jpg']),
  otherReferencedPaths: new Set(['brands/b1/draft-ref.jpg']),
  soakProtectedPaths: new Set(['brands/b1/old-original.jpg']),
}

it.each([
  [
    {
      path: 'brands/b/x.jpg',
      size: 900_000,
      contentType: 'image/jpeg',
      jsonbReferenced: false,
    },
    true,
  ],
  [
    {
      path: 'brands/b/x.webp',
      size: 90_000,
      contentType: 'image/webp',
      jsonbReferenced: false,
    },
    false,
  ],
  [
    {
      path: 'brands/b/x.webp',
      size: 400_000,
      contentType: 'image/webp',
      jsonbReferenced: false,
    },
    true,
  ],
  [
    {
      path: 'brands/b/x.gif',
      size: 900_000,
      contentType: 'image/gif',
      jsonbReferenced: false,
    },
    false,
  ],
  [
    {
      path: 'brands/b/x.jpg',
      size: 900_000,
      contentType: 'image/jpeg',
      jsonbReferenced: true,
    },
    false,
  ],
])('shouldReencode(%o) -> %s', (obj, expected) => {
  expect(shouldReencode(obj, { webpSkipBytes: 150 * 1024 })).toBe(expected)
})

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

describe('planPurge', () => {
  const categorized = {
    protected: [{ path: 'brands/protected.webp', size: 100 }],
    anomalies: [{ path: 'brands/anomaly.webp', size: 100 }],
    live: [{ path: 'brands/live.webp', size: 100 }],
    rejected: Array.from({ length: 1_820 }, (_, index) => ({
      path: `brands/rejected-${index}.webp`,
      size: 100,
    })),
    untracked: Array.from({ length: 2_056 }, (_, index) => ({
      path: `brands/untracked-${index}.webp`,
      size: 100,
    })),
  }

  it('plans deletions for rejected+untracked, respects sanity gate', () => {
    const plan = planPurge(categorized, {
      expectedRejected: 1_820,
      expectedUntracked: 2_056,
      tolerance: 0.15,
    })

    expect(plan.toDelete).toEqual(
      [...categorized.rejected, ...categorized.untracked].map(
        (object) => object.path,
      ),
    )
    expect(plan.withinSanityGate).toBe(true)
  })

  it('fails the sanity gate when counts deviate beyond tolerance', () => {
    const categorizedTiny = {
      ...categorized,
      rejected: [{ path: 'brands/rejected.webp', size: 100 }],
      untracked: [{ path: 'brands/untracked.webp', size: 100 }],
    }
    const plan = planPurge(categorizedTiny, {
      expectedRejected: 1_820,
      expectedUntracked: 2_056,
      tolerance: 0.15,
    })

    expect(plan.withinSanityGate).toBe(false)
  })

  it('excludes soak-protected keys from untracked deletions', () => {
    const protectedPath = 'brands/reencode-original.webp'
    const categorizedWithSoakProtection = categorizeObjects(
      [
        { path: protectedPath, size: 100 },
        { path: 'brands/untracked.webp', size: 100 },
      ],
      {
        activePaths: new Set(),
        rejectedPaths: new Set(),
        otherReferencedPaths: new Set(),
        soakProtectedPaths: new Set([protectedPath]),
      },
    )

    const plan = planPurge(categorizedWithSoakProtection, {
      expectedRejected: 0,
      expectedUntracked: 1,
      tolerance: 0.15,
    })

    expect(categorizedWithSoakProtection.protected).toEqual([
      { path: protectedPath, size: 100 },
    ])
    expect(plan.toDelete).not.toContain(protectedPath)
  })
})
