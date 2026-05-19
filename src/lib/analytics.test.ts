import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: vi.fn(),
}))

import { sendGAEvent } from '@next/third-parties/google'
import {
  trackBrandView,
  trackSubmissionStart,
  trackSubmissionStep,
  trackSubmissionComplete,
  trackFilterCategory,
  trackFilterSearch,
  trackGalleryPhotoView,
} from './analytics'

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trackBrandView sends brand_view event with slug', () => {
    trackBrandView('awesome-brand')
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'brand_view', {
      brand_slug: 'awesome-brand',
    })
  })

  it('trackSubmissionStart sends submission_start event', () => {
    trackSubmissionStart()
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'submission_start', {})
  })

  it('trackSubmissionStep sends submission_step event with step number', () => {
    trackSubmissionStep(2)
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'submission_step', {
      step_number: 2,
    })
  })

  it('trackSubmissionComplete sends submission_complete event', () => {
    trackSubmissionComplete()
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'submission_complete', {})
  })

  it('trackFilterCategory sends filter_category event with category', () => {
    trackFilterCategory('food-beverage')
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'filter_category', {
      category: 'food-beverage',
    })
  })

  it('trackFilterSearch sends filter_search event with query length', () => {
    trackFilterSearch(5)
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'filter_search', {
      query_length: 5,
    })
  })

  it('trackGalleryPhotoView sends gallery_photo_view event', () => {
    trackGalleryPhotoView('awesome-brand', 3)
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'gallery_photo_view', {
      brand_slug: 'awesome-brand',
      photo_index: 3,
    })
  })

  it('does not throw when sendGAEvent fails', () => {
    vi.mocked(sendGAEvent).mockImplementation(() => {
      throw new Error('gtag not loaded')
    })
    expect(() => trackBrandView('test')).not.toThrow()
  })
})
