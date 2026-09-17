import { describe, expect, it } from 'vitest'

import {
  buildRestorePlan,
  planSubmissionStorageMigration,
  verificationAction,
  type MigrationManifest,
} from '../submission-storage-migration'

const object = (path: string, size = 100, etag = `etag:${path}`) => ({
  path,
  size,
  etag,
})

describe('planSubmissionStorageMigration', () => {
  it('includes referenced and orphaned public submission objects', () => {
    const plan = planSubmissionStorageMigration({
      publicObjects: [
        object('submissions/referenced/hero.webp'),
        object('submissions/orphaned/photo.webp'),
      ],
      privateObjects: [],
      rows: [
        {
          table: 'submission_images',
          id: 'image-1',
          status: 'active',
          brandId: null,
          storagePath: 'submissions/referenced/hero.webp',
          url: '/i/submissions/referenced/hero.webp',
        },
      ],
    })

    expect(plan.moveObjects.map((entry) => entry.source.path)).toEqual([
      'submissions/orphaned/photo.webp',
      'submissions/referenced/hero.webp',
    ])
    expect(plan.orphanKeys).toEqual(['submissions/orphaned/photo.webp'])
    expect(plan.blockers).toEqual([])
  })

  it('adopts an equal verified private destination idempotently', () => {
    const source = object('submissions/submission-1/hero.webp')
    const plan = planSubmissionStorageMigration({
      publicObjects: [source],
      privateObjects: [{ ...source }],
      rows: [],
    })

    expect(plan.moveObjects).toEqual([
      { source, destination: source, action: 'adopt' },
    ])
    expect(plan.blockers).toEqual([])
  })

  it('blocks a differing or unverifiable private destination', () => {
    expect(() =>
      verificationAction(
        object('submissions/submission-1/hero.webp'),
        object('submissions/submission-1/hero.webp', 100, 'different'),
      ),
    ).toThrow(/differs/)
    expect(() =>
      verificationAction(
        object('submissions/submission-1/hero.webp', 100, ''),
        null,
      ),
    ).toThrow(/cannot be verified/)
  })

  it('promotes live brand rows and preserves rejected tombstones with null paths', () => {
    const key = 'submissions/submission-1/hero.webp'
    const plan = planSubmissionStorageMigration({
      publicObjects: [object(key)],
      privateObjects: [],
      rows: [
        {
          table: 'brand_images',
          id: 'active-image',
          status: 'active',
          brandId: 'brand-1',
          storagePath: key,
          url: `/i/${key}`,
        },
        {
          table: 'brand_images',
          id: 'rejected-image',
          status: 'rejected',
          brandId: 'brand-1',
          storagePath: key,
          url: `/i/${key}`,
        },
      ],
    })

    expect(plan.promotions).toEqual([
      expect.objectContaining({
        id: 'active-image',
        sourceKey: key,
        targetKey: 'brands/brand-1/hero.webp',
      }),
    ])
    expect(plan.nullTombstones).toEqual([
      expect.objectContaining({ id: 'rejected-image', storagePath: key }),
    ])
  })

  it('promotes a legacy brand row whose submission key survives only in its URL', () => {
    const key = 'submissions/submission-1/legacy.webp'
    const plan = planSubmissionStorageMigration({
      publicObjects: [object(key)],
      privateObjects: [],
      rows: [
        {
          table: 'brand_images',
          id: 'legacy-image',
          status: 'active',
          brandId: 'brand-1',
          storagePath: key,
          storedPath: null,
          url: `https://project.supabase.co/storage/v1/object/public/brand-images/${key}`,
        },
      ],
    })

    expect(plan.promotions).toEqual([
      expect.objectContaining({
        id: 'legacy-image',
        sourceKey: key,
        targetKey: 'brands/brand-1/legacy.webp',
        storedPath: null,
      }),
    ])
  })

  it('nulls a rejected submission row only when its object is missing', () => {
    const present = 'submissions/submission-1/present.webp'
    const missing = 'submissions/submission-1/missing.webp'
    const plan = planSubmissionStorageMigration({
      publicObjects: [object(present)],
      privateObjects: [],
      rows: [
        {
          table: 'submission_images',
          id: 'present',
          status: 'rejected',
          brandId: null,
          storagePath: present,
          url: `/i/${present}`,
        },
        {
          table: 'submission_images',
          id: 'missing',
          status: 'rejected',
          brandId: null,
          storagePath: missing,
          url: `/i/${missing}`,
        },
      ],
    })

    expect(plan.nullTombstones.map((row) => row.id)).toEqual(['missing'])
  })
})

it('builds rollback actions for every planned destructive object and row mutation', () => {
  const manifest: MigrationManifest = {
    version: 1,
    projectRef: 'project-ref',
    createdAt: '2026-09-17T00:00:00.000Z',
    brandImagesWasPublic: false,
    objects: [
      {
        key: 'submissions/submission-1/hero.webp',
        source: object('submissions/submission-1/hero.webp'),
        destinationExisted: false,
        sourceDeletePlanned: true,
      },
    ],
    rows: [
      {
        table: 'brand_images',
        id: 'image-1',
        before: {
          storagePath: 'submissions/submission-1/hero.webp',
          url: '/i/submissions/submission-1/hero.webp',
        },
        after: {
          storagePath: 'brands/brand-1/hero.webp',
          url: 'https://project.supabase.co/storage/v1/object/public/brand-images/brands/brand-1/hero.webp',
        },
        mutationPlanned: true,
      },
    ],
    promotedObjects: [
      {
        key: 'brands/brand-1/hero.webp',
        destinationExisted: false,
        createPlanned: true,
      },
    ],
  }

  expect(buildRestorePlan(manifest)).toEqual({
    restorePublicObjects: ['submissions/submission-1/hero.webp'],
    removeCreatedPublicObjects: ['brands/brand-1/hero.webp'],
    restoreRows: [manifest.rows[0]],
  })
})
