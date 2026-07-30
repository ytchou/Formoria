import { describe, expect, it } from 'vitest'
import { planActiveImageOrder, type ActiveImageForOrdering } from '../classify-images'

function row(
  id: string,
  overrides: Partial<ActiveImageForOrdering> = {},
): ActiveImageForOrdering {
  return { id, source: 'google_image', sort_order: 0, ...overrides }
}

describe('planActiveImageOrder', () => {
  it('gives unjudged active images distinct sort_orders instead of leaving them all at 0', () => {
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [row('judged'), row('unjudged-a'), row('unjudged-b')],
      rankedJudgedIds: ['judged'],
    })

    expect(demotedIds).toEqual([])
    expect(assignments).toEqual([
      { id: 'judged', sortOrder: 0 },
      { id: 'unjudged-a', sortOrder: 1 },
      { id: 'unjudged-b', sortOrder: 2 },
    ])
    // The invariant the database enforces: exactly one row at position 0.
    expect(assignments.filter((a) => a.sortOrder === 0)).toHaveLength(1)
    expect(new Set(assignments.map((a) => a.sortOrder)).size).toBe(assignments.length)
  })

  it('ranks judged images ahead of unjudged ones so an unranked image cannot become the hero', () => {
    const { assignments } = planActiveImageOrder({
      // Unjudged rows arrive first, but must not win position 0.
      activeImages: [row('unjudged'), row('best'), row('second')],
      rankedJudgedIds: ['best', 'second'],
    })

    expect(assignments.map((a) => a.id)).toEqual(['best', 'second', 'unjudged'])
    expect(assignments.at(0)).toEqual({ id: 'best', sortOrder: 0 })
  })

  it('keeps a human pick at its reserved position and never demotes it', () => {
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [
        row('admin-hero', { source: 'admin', sort_order: 0 }),
        row('judged'),
        row('unjudged'),
      ],
      rankedJudgedIds: ['judged'],
    })

    // The admin row is untouched, and nothing else is handed position 0.
    expect(assignments.map((a) => a.id)).not.toContain('admin-hero')
    expect(demotedIds).not.toContain('admin-hero')
    expect(assignments.some((a) => a.sortOrder === 0)).toBe(false)
    expect(assignments).toEqual([
      { id: 'judged', sortOrder: 1 },
      { id: 'unjudged', sortOrder: 2 },
    ])
  })

  it('caps active images at seven and demotes the lowest ranked overflow', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `img-${i}`)
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: ids.map((id) => row(id)),
      rankedJudgedIds: ids,
    })

    expect(assignments).toHaveLength(7)
    expect(assignments.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(demotedIds).toEqual(['img-7', 'img-8', 'img-9'])
  })

  it('counts human picks against the seven-slot cap', () => {
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [
        row('owner-1', { source: 'owner', sort_order: 0 }),
        row('owner-2', { source: 'owner', sort_order: 1 }),
        ...Array.from({ length: 8 }, (_, i) => row(`img-${i}`)),
      ],
      rankedJudgedIds: Array.from({ length: 8 }, (_, i) => `img-${i}`),
    })

    // Two reserved slots leave five for the classifier.
    expect(assignments).toHaveLength(5)
    expect(assignments.map((a) => a.sortOrder)).toEqual([2, 3, 4, 5, 6])
    expect(demotedIds).toHaveLength(3)
  })

  it('handles the all-unjudged case that produced the ten-rows-at-zero bug', () => {
    const { assignments } = planActiveImageOrder({
      activeImages: Array.from({ length: 4 }, (_, i) => row(`scraped-${i}`)),
      rankedJudgedIds: [],
    })

    expect(assignments.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3])
    expect(assignments.filter((a) => a.sortOrder === 0)).toHaveLength(1)
  })
})
