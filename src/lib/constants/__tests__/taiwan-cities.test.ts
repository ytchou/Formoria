import { describe, it, expect } from 'vitest'
import {
  TAIWAN_CITIES,
  CITY_SLUGS,
  CITY_NAMES_ZH,
  CITY_REGION_LABELS_ZH,
} from '../taiwan-cities'
import zhTW from '../../../../messages/zh-TW.json'

describe('CITY_NAMES_ZH', () => {
  /**
   * The enrichment pipeline cannot import the message catalog at runtime — the
   * curation worker runs `tsx` with no bundler and no `messages/` directory in
   * its image, and doing so crashed it in production. So the full city names
   * are duplicated into a TS constant, and this test is what stops the copy
   * from drifting away from the catalog the brand page actually renders.
   */
  it('matches the cities namespace in messages/zh-TW.json exactly', () => {
    expect(CITY_NAMES_ZH).toEqual(zhTW.cities)
  })

  it('covers every city slug', () => {
    for (const slug of CITY_SLUGS) {
      expect(CITY_NAMES_ZH[slug], `${slug} missing a zh name`).toBeTruthy()
    }
  })
})

describe('CITY_REGION_LABELS_ZH', () => {
  it('covers every city slug', () => {
    for (const slug of CITY_SLUGS) {
      expect(
        CITY_REGION_LABELS_ZH[slug],
        `${slug} missing a region label`,
      ).toBeTruthy()
    }
  })

  it('is the short form, distinct from the full page names', () => {
    expect(CITY_REGION_LABELS_ZH.taipei).toBe('台北')
    expect(CITY_NAMES_ZH.taipei).toBe('臺北市')
  })
})

describe('TAIWAN_CITIES', () => {
  it('exports exactly 22 cities', () => {
    expect(TAIWAN_CITIES).toHaveLength(22)
  })

  it('every city has required fields with non-empty values', () => {
    for (const city of TAIWAN_CITIES) {
      expect(city.slug, `${city.slug} missing slug`).toBeTruthy()
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
