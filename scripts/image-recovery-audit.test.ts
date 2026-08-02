import { describe, expect, it } from 'vitest'
import { planPendingRecovery, type PendingImageRow } from './image-recovery-audit'

function row(overrides: Partial<PendingImageRow> = {}): PendingImageRow {
  return {
    id: 'image-1',
    status: 'active',
    source: 'google_image',
    source_url: 'https://source.example.com/image.webp',
    url: 'https://storage.example.com/image.webp',
    storage_path: 'brands/brand-1/image.webp',
    tags: null,
    rejection_reasons: null,
    rejected_at: null,
    ...overrides,
  }
}

describe('planPendingRecovery', () => {
  it('blocks active unclassified automated rows without publishing them', () => {
    const [entry] = planPendingRecovery([
      { table: 'brand_images', row: row() },
    ])

    expect(entry).toMatchObject({
      action: 'block',
      row: { status: 'active', source_url: 'https://source.example.com/image.webp' },
    })
  })

  it('does not touch already blocked or human-owned rows', () => {
    const entries = planPendingRecovery([
      { table: 'brand_images', row: row({ id: 'candidate', status: 'candidate' }) },
      { table: 'brand_images', row: row({ id: 'owner', source: 'owner' }) },
      { table: 'submission_images', row: row({ id: 'admin', source: 'admin' }) },
      { table: 'brand_images', row: row({ id: 'rejected', status: 'rejected' }) },
    ])

    expect(entries.map((entry) => [entry.row.id, entry.action])).toEqual([
      ['candidate', 'already_blocked'],
    ])
  })
})
