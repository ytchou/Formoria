import { sendGAEvent } from '@next/third-parties/google'

export function trackBrandView(slug: string) {
  try {
    sendGAEvent('event', 'brand_view', { brand_slug: slug })
  } catch {
    // Graceful degradation — ad blockers or missing GA ID
  }
}

export function trackSubmissionStart() {
  try {
    sendGAEvent('event', 'submission_start', {})
  } catch {
    // Graceful degradation
  }
}

export function trackSubmissionStep(step: number) {
  try {
    sendGAEvent('event', 'submission_step', { step_number: step })
  } catch {
    // Graceful degradation
  }
}

export function trackSubmissionComplete() {
  try {
    sendGAEvent('event', 'submission_complete', {})
  } catch {
    // Graceful degradation
  }
}

export function trackFilterCategory(category: string) {
  try {
    sendGAEvent('event', 'filter_category', { category })
  } catch {
    // Graceful degradation
  }
}

export function trackFilterSearch(queryLength: number) {
  try {
    sendGAEvent('event', 'filter_search', { query_length: queryLength })
  } catch {
    // Graceful degradation
  }
}

export function trackGalleryPhotoView(slug: string, index: number) {
  try {
    sendGAEvent('event', 'gallery_photo_view', {
      brand_slug: slug,
      photo_index: index,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchQuery(searchTerm: string) {
  try {
    sendGAEvent('event', 'search', { search_term: searchTerm })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchSuggestionSelect(slug: string) {
  try {
    sendGAEvent('event', 'select_content', {
      content_type: 'brand_suggestion',
      item_id: slug,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchNoResults(searchTerm: string) {
  try {
    sendGAEvent('event', 'search_no_results', { search_term: searchTerm })
  } catch {
    // Graceful degradation
  }
}
