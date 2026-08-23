import { describe, expect, it } from 'vitest'
import { ANALYTICS_EVENTS } from './events'

// PostHog can neither rename an event nor delete one selectively. Every assertion
// here exists to make an accidental rename fail in CI instead of silently splitting
// a metric's history into two irreconcilable time series.
const EVENT_NAME_SNAPSHOT = [
  'brand_list_viewed',
  'stockist_list_viewed',
  'brand_card_clicked',
  'booth_selected',
  'exhibitor_site_clicked',
  'hero_category_clicked',
  'curated_product_clicked',
  'story_card_clicked',
  'trail_card_clicked',
  'directory_sort_changed',
  'directory_page_navigated',
  'category_filter_applied',
  'subcategory_filter_applied',
  'price_filter_applied',
  'verification_filter_applied',
  'filter_cleared',
  'language_switched',
  'brand_detail_viewed',
  'brand_detail_engaged',
  'external_link_clicked',
  'brand_page_shared',
  'gallery_photo_viewed',
  'gallery_completed',
  'faq_item_expanded',
  'recommendation_brand_clicked',
  'recommendation_section_viewed',
  'brand_search_executed',
  'brand_search_empty',
  'search_result_clicked',
  'search_suggestion_selected',
  'brand_saved',
  'saved_brand_revisited',
  'brand_unsaved',
  'submission_form_opened',
  'submission_path_selected',
  'submission_form_step_completed',
  'submission_completed',
  'submission_form_abandoned',
  'submission_form_error_shown',
  'newsletter_subscribed',
  'brand_claim_started',
  'brand_claim_form_submitted',
  'brand_claim_completed',
  'brand_claim_approved',
  'brand_listing_published',
  'mit_declared',
  'origin_evidence_submitted',
  'brand_reported',
  'brand_correction_submitted',
  'user_signed_up',
  'user_logged_in',
  'user_signed_out',
  'user_authenticated',
  'cta_clicked',
  'api_error_shown',
  'asset_uploaded',
  'challenge_verified',
  'rate_limit_store_unavailable',
  'rate_limit_store_recovered',
  'rate_limit_blocked',
  // Enforcement ladder (DEV-1551). Eleven names, and the ladder ships in
  // log-only observe mode, so these are its entire output until thresholds are
  // calibrated. `docs/runbooks/anti-enumeration.md` names the alerts built on
  // them.
  'scrape_ladder_recorded',
  'scrape_ladder_challenged',
  'scrape_ladder_blocked',
  'scrape_ladder_extended_block',
  'scrape_ladder_shadowed',
  'scrape_verified_budget_exhausted',
  'scrape_identity_rotation_suspected',
  'verified_crawler_allowed',
  'known_crawler_blocked',
  'visitor_identity_rotated',
  'rate_limiter_degraded',
  'web_vital_reported',
]

describe('analytics event registry', () => {
  it('has no duplicate event names', () => {
    const values = Object.values(ANALYTICS_EVENTS)
    // A duplicate value would silently merge two metrics into one series.
    expect(new Set(values).size).toBe(values.length)
  })

  it('uses snake_case for every event name', () => {
    for (const value of Object.values(ANALYTICS_EVENTS)) {
      expect(value).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/)
    }
  })

  it('matches the permanence snapshot exactly', () => {
    // If this fails you renamed, removed, or added an event. Adding: extend the
    // snapshot. Renaming or removing: don't — PostHog cannot follow you.
    expect([...Object.values(ANALYTICS_EVENTS)].sort()).toEqual(
      [...EVENT_NAME_SNAPSHOT].sort(),
    )
  })
})
