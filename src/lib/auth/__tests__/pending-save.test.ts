import { describe, expect, it } from 'vitest'

import {
  matchesPendingSave,
  parsePendingSave,
  PENDING_SAVE_STORAGE_KEY,
  PENDING_SAVE_TTL_MS,
  serializePendingSave,
  takePendingSave,
  writePendingSave,
} from '@/lib/auth/pending-save'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
  }
}

const NOW = 1_800_000_000_000

describe('parsePendingSave', () => {
  it('round-trips a serialized marker', () => {
    expect(
      parsePendingSave(serializePendingSave('brand', 'b1', NOW), NOW)
    ).toEqual({
      kind: 'brand',
      id: 'b1',
      createdAt: NOW,
    })
  })

  it('keeps a marker right up to the expiry and drops it after', () => {
    const raw = serializePendingSave('product', 'p1', NOW)
    expect(parsePendingSave(raw, NOW + PENDING_SAVE_TTL_MS)).not.toBeNull()
    expect(parsePendingSave(raw, NOW + PENDING_SAVE_TTL_MS + 1)).toBeNull()
  })

  it('rejects a marker stamped in the future', () => {
    expect(
      parsePendingSave(serializePendingSave('brand', 'b1', NOW + 1), NOW)
    ).toBeNull()
  })

  it.each([
    ['missing', null],
    ['not JSON', '{nope'],
    ['not an object', '"brand"'],
    [
      'unknown kind',
      JSON.stringify({ kind: 'story', id: 'x', createdAt: NOW }),
    ],
    ['empty id', JSON.stringify({ kind: 'brand', id: '', createdAt: NOW })],
    [
      'non-numeric time',
      JSON.stringify({ kind: 'brand', id: 'b1', createdAt: 'now' }),
    ],
  ])('returns null when the marker is %s', (_label, raw) => {
    expect(parsePendingSave(raw, NOW)).toBeNull()
  })
})

describe('matchesPendingSave', () => {
  const pending = { kind: 'brand' as const, id: 'b1', createdAt: NOW }

  it('matches only the same kind and id', () => {
    expect(matchesPendingSave(pending, 'brand', 'b1')).toBe(true)
    expect(matchesPendingSave(pending, 'product', 'b1')).toBe(false)
    expect(matchesPendingSave(pending, 'brand', 'b2')).toBe(false)
    expect(matchesPendingSave(null, 'brand', 'b1')).toBe(false)
  })
})

describe('writePendingSave / takePendingSave', () => {
  it('applies once: the first matching take consumes the marker', () => {
    const storage = memoryStorage()
    writePendingSave(storage, 'product', 'p1', NOW)

    expect(takePendingSave(storage, 'product', 'p1', NOW + 1000)).toBe(true)
    expect(takePendingSave(storage, 'product', 'p1', NOW + 1000)).toBe(false)
    expect(storage.items.has(PENDING_SAVE_STORAGE_KEY)).toBe(false)
  })

  it('leaves a valid marker for a different item in place', () => {
    const storage = memoryStorage()
    writePendingSave(storage, 'brand', 'b1', NOW)

    expect(takePendingSave(storage, 'brand', 'b2', NOW)).toBe(false)
    expect(takePendingSave(storage, 'product', 'b1', NOW)).toBe(false)
    expect(storage.items.has(PENDING_SAVE_STORAGE_KEY)).toBe(true)
  })

  it('removes an expired marker without applying it', () => {
    const storage = memoryStorage()
    writePendingSave(storage, 'brand', 'b1', NOW)

    expect(
      takePendingSave(storage, 'brand', 'b1', NOW + PENDING_SAVE_TTL_MS + 1)
    ).toBe(false)
    expect(storage.items.has(PENDING_SAVE_STORAGE_KEY)).toBe(false)
  })

  it('a later write replaces the earlier marker', () => {
    const storage = memoryStorage()
    writePendingSave(storage, 'brand', 'b1', NOW)
    writePendingSave(storage, 'product', 'p1', NOW)

    expect(takePendingSave(storage, 'brand', 'b1', NOW)).toBe(false)
    expect(takePendingSave(storage, 'product', 'p1', NOW)).toBe(true)
  })

  it('is a no-op without storage, and survives a storage that throws', () => {
    expect(() => writePendingSave(null, 'brand', 'b1', NOW)).not.toThrow()
    expect(takePendingSave(null, 'brand', 'b1', NOW)).toBe(false)

    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => writePendingSave(throwing, 'brand', 'b1', NOW)).not.toThrow()
    expect(takePendingSave(throwing, 'brand', 'b1', NOW)).toBe(false)
  })
})
