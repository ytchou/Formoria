import { describe, it, expect } from 'vitest'
import { TAIWAN_CITIES, CITY_SLUGS } from '../taiwan-cities'

describe('TAIWAN_CITIES', () => {
  it('exports exactly 22 cities', () => {
    expect(TAIWAN_CITIES).toHaveLength(22)
  })

  it('every city has required fields with non-empty values', () => {
    for (const city of TAIWAN_CITIES) {
      expect(city.slug, `${city.slug} missing slug`).toBeTruthy()
      expect(city.nameZh, `${city.slug} missing nameZh`).toBeTruthy()
      expect(city.nameEn, `${city.slug} missing nameEn`).toBeTruthy()
      expect(city.topoId, `${city.slug} missing topoId`).toBeTruthy()
    }
  })

  it('all slugs are unique', () => {
    const slugs = TAIWAN_CITIES.map(c => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('all topoIds are unique', () => {
    const ids = TAIWAN_CITIES.map(c => c.topoId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('CITY_SLUGS is a flat array of all slugs', () => {
    expect(CITY_SLUGS).toHaveLength(22)
    expect(CITY_SLUGS).toContain('taipei')
    expect(CITY_SLUGS).toContain('kaohsiung')
  })
})
