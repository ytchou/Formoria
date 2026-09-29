import { describe, expect, it } from 'vitest'

import { assignSplits, readSplit, splitOf, type Split } from '../splits'

type Item = { id: string; label: string; split?: Split }

const item = (id: string, label = 'a', split?: Split): Item => ({ id, label, ...(split ? { split } : {}) })
const byLabel = { strataOf: (i: Item) => i.label, pinnedToTrain: new Set<string>() }

function counts(items: Item[], label: string): Record<Split, number> {
  const inStratum = items.filter((i) => i.label === label)
  return {
    train: inStratum.filter((i) => i.split === 'train').length,
    val: inStratum.filter((i) => i.split === 'val').length,
    holdout: inStratum.filter((i) => i.split === 'holdout').length,
  }
}

describe('assignSplits', () => {
  it('deals 60/20/20 within ±1 per stratum', () => {
    const items = [
      ...Array.from({ length: 23 }, (_, i) => item(`a-${i}`, 'a')),
      ...Array.from({ length: 11 }, (_, i) => item(`b-${i}`, 'b')),
      ...Array.from({ length: 7 }, (_, i) => item(`c-${i}`, 'c')),
    ]
    const split = assignSplits(items, { seed: 'seed-a', ...byLabel })

    expect(split.every((i) => i.split !== undefined)).toBe(true)
    for (const [label, size] of [['a', 23], ['b', 11], ['c', 7]] as const) {
      const got = counts(split, label)
      // Within one item of the rounded 60/20/20 target.
      expect(Math.abs(got.train - Math.round(size * 0.6))).toBeLessThanOrEqual(1)
      expect(Math.abs(got.val - Math.round(size * 0.2))).toBeLessThanOrEqual(1)
      expect(Math.abs(got.holdout - Math.round(size * 0.2))).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic for the same seed', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`x-${i}`, i % 3 === 0 ? 'a' : 'b'))
    const splitsOf = (list: Item[]) => Object.fromEntries(list.map((i) => [i.id, i.split]))

    const first = splitsOf(assignSplits(items, { seed: 'seed-a', ...byLabel }))
    expect(splitsOf(assignSplits([...items].reverse(), { seed: 'seed-a', ...byLabel }))).toEqual(first)
    expect(splitsOf(assignSplits(items, { seed: 'seed-b', ...byLabel }))).not.toEqual(first)
  })

  it('pins pinned ids to train', () => {
    const items = [item('quoted', 'a', 'holdout'), ...Array.from({ length: 10 }, (_, i) => item(`x-${i}`))]
    const split = assignSplits(items, {
      seed: 'seed-a',
      strataOf: () => 'all',
      pinnedToTrain: new Set(['quoted', 'x-3']),
    })
    const byId = new Map(split.map((i) => [i.id, i.split]))

    expect(byId.get('quoted')).toBe('train')
    expect(byId.get('x-3')).toBe('train')
  })

  it('an item keeps its existing split', () => {
    const items = [
      item('old-0', 'a', 'holdout'),
      item('old-1', 'a', 'val'),
      item('old-2', 'a', 'train'),
      ...Array.from({ length: 10 }, (_, i) => item(`new-${i}`)),
    ]
    const split = assignSplits(items, { seed: 'seed-a', ...byLabel })
    const byId = new Map(split.map((i) => [i.id, i.split]))

    expect([byId.get('old-0'), byId.get('old-1'), byId.get('old-2')]).toEqual(['holdout', 'val', 'train'])
    // Re-running after an expansion moves nothing that already has a split.
    const again = assignSplits([...split, item('newer')], { seed: 'seed-a', ...byLabel })
    for (const i of split) expect(again.find((j) => j.id === i.id)?.split).toBe(i.split)
  })
})

describe('readSplit / splitOf', () => {
  it('reads a recognised split, flags an unrecognised one, and treats missing or empty as none', () => {
    expect(readSplit({ split: 'val' })).toEqual({ split: 'val' })
    expect(readSplit({ split: 'test' })).toEqual({ unrecognised: 'test' })
    expect(readSplit({ split: 'Holdout' })).toEqual({ unrecognised: 'Holdout' })
    for (const metadata of [undefined, null, 'x', {}, { split: null }, { split: '' }]) expect(readSplit(metadata)).toEqual({})
    expect(splitOf({ split: 'holdout' })).toBe('holdout')
    expect(splitOf({ split: 'test' })).toBeUndefined()
  })
})
