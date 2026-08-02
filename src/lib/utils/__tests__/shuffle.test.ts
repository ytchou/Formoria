import { describe, it, expect } from 'vitest'
import { shuffle } from '../index'

/**
 * Feeds the generator a fixed script, so the permutation is a fact the test can
 * assert rather than a coin flip. Each value is the fraction Fisher-Yates
 * multiplies by `i + 1` to pick the swap partner for index `i`.
 */
function stubbedRandom(values: number[]): () => number {
  let call = 0
  return () => values[call++] ?? 0
}

describe('shuffle', () => {
  it('shuffle_produces_a_known_permutation_from_a_stubbed_generator', () => {
    // Descending pass over ['a','b','c','d']:
    //   i=3, random 0    -> j=0, swap a/d -> d b c a
    //   i=2, random 0.5  -> j=1, swap b/c -> d c b a
    //   i=1, random 0.99 -> j=1, no move  -> d c b a
    expect(shuffle(['a', 'b', 'c', 'd'], stubbedRandom([0, 0.5, 0.99]))).toEqual([
      'd',
      'c',
      'b',
      'a',
    ])
  })

  it('shuffle_returns_a_permutation_without_dropping_or_duplicating_items', () => {
    // The lineup this backs is the crawlable substance of the event page, so a
    // reordering that loses or repeats an entry is a content bug, not a
    // cosmetic one.
    const input = Array.from({ length: 38 }, (_, i) => i)
    const output = shuffle(input, stubbedRandom([0.1, 0.9, 0.42, 0.7, 0.03]))

    expect(output).toHaveLength(input.length)
    expect([...output].sort((a, b) => a - b)).toEqual(input)
  })

  it('shuffle_leaves_the_input_array_untouched', () => {
    // Callers pass lists they do not own; an in-place shuffle would reorder the
    // array for everything else holding the same reference.
    const input = ['a', 'b', 'c']
    const output = shuffle(input, stubbedRandom([0, 0]))

    expect(input).toEqual(['a', 'b', 'c'])
    expect(output).not.toBe(input)
  })
})
