'use server'

import {
  searchLocations,
  type LocationSearchResult,
} from '@/lib/services/location-search'

type SearchLocationResult =
  | {
      success: true
      results: LocationSearchResult[]
    }
  | {
      success: false
      error: string
    }

export async function searchLocationAction(
  query: string,
  locale?: string,
): Promise<SearchLocationResult> {
  try {
    return {
      success: true,
      results: await searchLocations(query, locale),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unable to search locations',
    }
  }
}
