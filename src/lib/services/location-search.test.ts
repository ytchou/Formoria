import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchLocations } from './location-search'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('searchLocations', () => {
  it('queries Nominatim once and normalizes selectable results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 123,
          osm_type: 'node',
          osm_id: 456,
          lat: '25.072',
          lon: '121.366',
          display_name: '林口三井, 新北市, 台灣',
          namedetails: { name: '林口三井' },
        },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await searchLocations('林口三井', 'zh-TW')

    expect(results).toEqual([
      {
        id: 'node-456',
        name: '林口三井',
        address: '林口三井, 新北市, 台灣',
        latitude: 25.072,
        longitude: 121.366,
      },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls.at(0) ?? []
    expect(String(url)).toContain('format=jsonv2')
    expect(String(url)).toContain('countrycodes=tw')
    expect(init?.headers).toMatchObject({
      'Accept-Language': 'zh-TW',
    })
  })

  it('waits for the external rate interval instead of returning empty results', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            place_id: 124,
            lat: '25.033',
            lon: '121.565',
            display_name: '台北 101, 台北市, 台灣',
            namedetails: { name: '台北 101' },
          },
        ],
      })
    vi.stubGlobal('fetch', fetchMock)

    const firstSearch = searchLocations('林口三井 unique one', 'zh-TW')
    await vi.advanceTimersByTimeAsync(1000)
    await firstSearch
    const secondSearch = searchLocations('台北 101 unique two', 'zh-TW')
    await vi.advanceTimersByTimeAsync(1000)

    await expect(secondSearch).resolves.toEqual([
      expect.objectContaining({ name: '台北 101' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
