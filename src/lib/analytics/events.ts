/**
 * Canonical analytics event registry.
 *
 * This module is the **sole place** analytics event-name string literals may exist.
 * `scripts/check-event-registry.mjs` fails CI when a bare literal is passed to
 * `capturePostHogEvent(...)` or `posthog.capture(...)` anywhere else under `src/`.
 *
 * ## Why the names are permanent
 *
 * PostHog cannot rename an event ("requires updating every existing event in the
 * database") and cannot selectively delete one. A rename produces two broken time
 * series joined only by an action bridge, forever. Treat every value below as an
 * immutable public identifier: add new keys freely, never edit an existing value.
 * `events.test.ts` holds a hardcoded snapshot of the full list as the permanence guard.
 *
 * The same applies to property **types**: type mutation is the top decay vector for a
 * PostHog project, because historical rows keep the old type and every aggregate over
 * the boundary silently becomes wrong.
 *
 * Governance, metric definitions, and known data caveats: `docs/analytics/metrics.md`.
 */

/**
 * UTM parameters spread onto acquisition-relevant events by `getUtmParams()`.
 * Every key is optional — only the params present on the landing URL are attached.
 */
export interface UtmProperties {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export const ANALYTICS_EVENTS = {
  // ---------------------------------------------------------------------------
  // Discovery — directory listing, filters, sorting, pagination
  // ---------------------------------------------------------------------------

  /**
   * A directory or curated brand list was rendered.
   * @property list_name {string} Which list rendered (e.g. directory grid, homepage section).
   * @property item_count {number} Number of brand cards in the rendered list.
   */
  BRAND_LIST_VIEWED: 'brand_list_viewed',

  /**
   * A brand card in a list was clicked through to the brand detail page.
   * Excludes the recommendation-card variant, which emits `recommendation_brand_clicked`.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property category {string | null} Primary category of the clicked brand, null when unset.
   * @property position_in_grid {number} 0-based position of the card within the rendered grid.
   */
  BRAND_CARD_CLICKED: 'brand_card_clicked',

  /**
   * A category tile in the homepage hero was clicked.
   * @property category {string} Category key.
   * @property destination_url {string} Resolved href the tile navigates to.
   */
  HERO_CATEGORY_CLICKED: 'hero_category_clicked',

  /**
   * The directory sort control changed value.
   * @property sort_value {string} Newly selected sort key.
   * @property previous_sort {string} Sort key in effect before the change.
   */
  DIRECTORY_SORT_CHANGED: 'directory_sort_changed',

  /**
   * The directory pager moved to another page.
   * @property page_number {number} Destination page (1-based).
   * @property direction {string} Navigation direction / control used.
   * @property total_pages {number} Total pages in the current result set.
   */
  DIRECTORY_PAGE_NAVIGATED: 'directory_page_navigated',

  /**
   * A top-level category filter was applied.
   * No `result_count`: no facet count is available at click time for this control.
   * @property category {string} Category key applied.
   */
  CATEGORY_FILTER_APPLIED: 'category_filter_applied',

  /**
   * A subcategory chip filter was applied. The only filter event carrying `result_count`,
   * because the facet count is already rendered on the chip and known before navigation.
   * @property subcategory {string} Subcategory key applied.
   * @property parent_category {string} Parent category of the subcategory.
   * @property result_count {number} Post-filter brand count from the chip facet; always an integer.
   */
  SUBCATEGORY_FILTER_APPLIED: 'subcategory_filter_applied',

  /**
   * A price-range filter was applied.
   * @property price_range {string} Price bucket key.
   */
  PRICE_FILTER_APPLIED: 'price_filter_applied',

  /**
   * A manufacturing-verification tier filter was applied.
   * No `result_count`: no facet count is available at click time for this control.
   * @property status {string} Verification tier key.
   */
  VERIFICATION_FILTER_APPLIED: 'verification_filter_applied',

  /**
   * A filter was cleared — either one chip or the whole set.
   * @property clear_type {string} Scope of the clear (single filter vs clear-all).
   * @property filter_type {string | undefined} Which filter was cleared; absent on clear-all.
   * @property filter_value {string | undefined} Value that was cleared; absent on clear-all.
   */
  FILTER_CLEARED: 'filter_cleared',

  /**
   * The site locale was switched.
   * @property from_locale {string} Locale before the switch.
   * @property to_locale {string} Locale after the switch.
   * @property location {string} UI surface hosting the switcher.
   */
  LANGUAGE_SWITCHED: 'language_switched',

  // ---------------------------------------------------------------------------
  // Brand detail — views, engagement depth, media, sharing, outbound
  // ---------------------------------------------------------------------------

  /**
   * A brand detail page was viewed. Widest-reach behavioural event; the real top of funnel.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property source {string} How the visitor arrived: search / category / directory / direct / recommendation.
   */
  BRAND_DETAIL_VIEWED: 'brand_detail_viewed',

  /**
   * First qualifying signal that a visitor genuinely engaged with a brand page,
   * rather than bouncing. Emitted at most once per page view, on the first trigger.
   * This is the engagement qualification gate for the north-star metric.
   * @property brand_slug {string} Brand slug.
   * @property trigger {string} Which signal qualified: dwell (>=15s) / gallery / faq / channel / scroll_50.
   * @property brand_id {string | undefined} Brand UUID; omitted when unavailable at emit time.
   */
  BRAND_DETAIL_ENGAGED: 'brand_detail_engaged',

  /**
   * An outbound link to a brand's own site or purchase channel was clicked.
   * The primary conversion proxy. Defensible as an observable proxy, never as a raw count
   * (see `docs/analytics/metrics.md` §Validity caveats).
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property link_type {string} Kind of destination (official site, marketplace, social, …).
   * @property surface {string} Where the click happened: detail_page / card / recommendation.
   */
  EXTERNAL_LINK_CLICKED: 'external_link_clicked',

  /**
   * The brand page share dialog completed a share through a channel.
   * @property brand_id {string | undefined} Brand UUID; omitted when unavailable.
   * @property brand_slug {string} Brand slug.
   * @property method {string | undefined} Share channel; `'x'` appears in history only (retired DEV-1242).
   */
  BRAND_PAGE_SHARED: 'brand_page_shared',

  /**
   * A photo in the brand gallery was opened or advanced to.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property photo_index {number} 0-based index of the photo viewed.
   */
  GALLERY_PHOTO_VIEWED: 'gallery_photo_viewed',

  /**
   * The visitor reached the end of a brand's gallery.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property image_count {number} Total images in the gallery.
   */
  GALLERY_COMPLETED: 'gallery_completed',

  /**
   * An FAQ accordion item on a brand page was expanded.
   * @property brand_slug {string} Brand slug.
   * @property item_index {number} 0-based index of the expanded item.
   */
  FAQ_ITEM_EXPANDED: 'faq_item_expanded',

  /**
   * A brand in the "you may also like" section was clicked.
   * @property brand_id {string} Destination brand UUID.
   * @property brand_slug {string} Destination brand slug.
   * @property source_brand_slug {string} Slug of the brand page hosting the recommendation.
   * @property position {number} 0-based position within the recommendation row.
   */
  RECOMMENDATION_BRAND_CLICKED: 'recommendation_brand_clicked',

  /**
   * The recommendation section scrolled into view on a brand page.
   * @property source_brand_slug {string} Slug of the hosting brand page.
   * @property recommendation_count {number} Number of recommendations rendered.
   */
  RECOMMENDATION_SECTION_VIEWED: 'recommendation_section_viewed',

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * A brand search ran. Raw query text is deliberately never sent — the privacy policy
   * excludes search text from analytics; `query_length` preserves the useful signal.
   * @property query_length {number} Character length of the query.
   * @property result_count {number} Number of results returned.
   * @property has_results {boolean} Whether the query returned anything.
   */
  BRAND_SEARCH_EXECUTED: 'brand_search_executed',

  /**
   * A search returned zero results. Denominator partner of `brand_search_executed`
   * for the query success rate.
   * @property query_length {number} Character length of the query.
   */
  BRAND_SEARCH_EMPTY: 'brand_search_empty',

  /**
   * A result on the search results page was clicked.
   * @property query_length {number} Character length of the query.
   * @property position_in_results {number} 0-based rank of the clicked result.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   */
  SEARCH_RESULT_CLICKED: 'search_result_clicked',

  /**
   * A typeahead suggestion in the search box was selected.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   */
  SEARCH_SUGGESTION_SELECTED: 'search_suggestion_selected',

  // ---------------------------------------------------------------------------
  // Saved / liked brands
  // ---------------------------------------------------------------------------

  /**
   * A brand was saved to the visitor's list.
   * Zero post-launch volume as of 2026-08-01 — the saves clause of the north-star
   * numerator stays dormant until this reaches n>=30.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property location {string} UI surface the save was triggered from.
   */
  BRAND_SAVED: 'brand_saved',

  /**
   * A previously saved brand was returned to. Strongest return-with-intent signal.
   * @property brand_slug {string} Brand slug.
   * @property surface {string} Where the revisit started: card / detail_page.
   * @property brand_id {string | undefined} Brand UUID; omitted when unavailable at emit time.
   */
  SAVED_BRAND_REVISITED: 'saved_brand_revisited',

  /**
   * A brand was removed from the visitor's saved list.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property location {string} UI surface the unsave was triggered from.
   */
  BRAND_UNSAVED: 'brand_unsaved',

  /**
   * A brand was liked from the brand detail page.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property location {string} Always `'brand_detail'` — the only surface exposing the control.
   */
  BRAND_LIKED: 'brand_liked',

  /**
   * A like was withdrawn from the brand detail page.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property location {string} Always `'brand_detail'`.
   */
  BRAND_UNLIKED: 'brand_unliked',

  // ---------------------------------------------------------------------------
  // Submission funnel
  // ---------------------------------------------------------------------------

  /**
   * The submission form was opened.
   * @property source {string} Entry point: header_cta / hero_cta / footer_link / quick.
   * @property intent {string} Normalized intent: recommend / owner_claim.
   */
  SUBMISSION_FORM_OPENED: 'submission_form_opened',

  /**
   * The submitter chose a submission path on the intent chooser.
   * @property path {string} Chosen path key.
   * @property is_authenticated {boolean} Whether the visitor was signed in.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  SUBMISSION_PATH_SELECTED: 'submission_path_selected',

  /**
   * A step of the multi-step submission form was completed.
   * @property step {string} Step identifier.
   */
  SUBMISSION_FORM_STEP_COMPLETED: 'submission_form_step_completed',

  /**
   * A brand submission was successfully created. Brand name is deliberately not sent
   * to PostHog (GA only) to keep pre-moderation names out of the event stream.
   * @property category {string} Selected category.
   * @property has_logo {boolean} Whether a logo was uploaded.
   * @property time_spent_seconds {number} Wall-clock seconds from form open to submit.
   * @property intent {string} recommend / owner_claim.
   * @property guest_submission {boolean} Whether the submitter was unauthenticated.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  SUBMISSION_COMPLETED: 'submission_completed',

  /**
   * The submission form was left without completing.
   * @property last_step_completed {string} Last step the submitter finished.
   * @property time_spent_seconds {number} Wall-clock seconds before abandonment.
   */
  SUBMISSION_FORM_ABANDONED: 'submission_form_abandoned',

  /**
   * A validation error was displayed inside the submission form.
   * @property field {string} Field that failed.
   * @property error_type {string} Validation failure kind.
   * @property step {string} Step the error occurred on.
   */
  SUBMISSION_FORM_ERROR_SHOWN: 'submission_form_error_shown',

  /**
   * The newsletter opt-in was submitted.
   * @property interests {string[]} Selected interest keys.
   * @property has_email {boolean} Whether an email address was supplied.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  NEWSLETTER_SUBSCRIBED: 'newsletter_subscribed',

  // ---------------------------------------------------------------------------
  // Claim, supply side, and moderation outcomes
  // ---------------------------------------------------------------------------

  /**
   * An owner started the claim flow for a brand.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property is_authenticated {boolean} Whether the claimant was signed in at start.
   */
  BRAND_CLAIM_STARTED: 'brand_claim_started',

  /**
   * The claim form was submitted with its proof attachments.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property proof_types {string[]} Kinds of proof attached.
   */
  BRAND_CLAIM_FORM_SUBMITTED: 'brand_claim_form_submitted',

  /**
   * Server-side: a claim was completed after the magic-link callback verified the
   * claimant's email. Emitted from `/auth/callback`.
   * @property brand_id {string} Brand UUID.
   * @property is_new_user {boolean} Whether the claimant signed up during this flow.
   */
  BRAND_CLAIM_COMPLETED: 'brand_claim_completed',

  /**
   * Server-side: an admin approved a claim request. Attributed to the claiming owner,
   * not the approving admin.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string | undefined} Brand slug; omitted when the claim row has none.
   * @property claim_request_id {string} Claim request UUID.
   */
  BRAND_CLAIM_APPROVED: 'brand_claim_approved',

  /**
   * Server-side: a submitted brand was approved and published. Attributed to the
   * submitter, not the approving admin. Covers both single and bulk approval.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property is_brand_owner {boolean} Whether the submitter is the brand's owner.
   */
  BRAND_LISTING_PUBLISHED: 'brand_listing_published',

  /**
   * Server-side: a brand owner published an edit from the owner dashboard.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Slug after the publish (may differ from the pre-edit slug).
   */
  BRAND_OWNER_EDIT_PUBLISHED: 'brand_owner_edit_published',

  /**
   * A manufacturing-origin declaration was made during the claim flow.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property declared_scope {string} Declared MIT scope.
   */
  MIT_DECLARED: 'mit_declared',

  /**
   * Origin evidence was submitted for verification.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property stance {string} Evidence stance submitted.
   */
  ORIGIN_EVIDENCE_SUBMITTED: 'origin_evidence_submitted',

  /**
   * A brand listing was reported by a visitor or owner.
   * @property brand_slug {string} Brand slug.
   * @property reason {string} Report reason key.
   * @property reporter_role {string} Role of the reporter.
   */
  BRAND_REPORTED: 'brand_reported',

  /**
   * A correction to a brand field was suggested.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property field {string} Field the correction targets.
   */
  BRAND_CORRECTION_SUBMITTED: 'brand_correction_submitted',

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /**
   * A new account was created.
   * @property method {string} Auth method used.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  USER_SIGNED_UP: 'user_signed_up',

  /**
   * An existing user signed in.
   *
   * ⚠️ **Data caveat:** all `user_logged_in` data before **2026-08-01** is inflated.
   * `GaUserSync` inferred a login from a client-side `null → user` transition, so every
   * full page load while signed in — and every transient auth error — looked like a login.
   * Root-caused and fixed 2026-08-01 (the post-auth redirect now stamps `auth_event=login`).
   * Do not use pre-2026-08-01 data for any login rate, funnel, or trend.
   *
   * @property method {string} Auth method used.
   */
  USER_LOGGED_IN: 'user_logged_in',

  /**
   * A user signed out. Emitted through `resetPostHogUser()` as the final buffered
   * capture, so it survives the identity reset.
   */
  USER_SIGNED_OUT: 'user_signed_out',

  /**
   * Server-side: the auth callback resolved a session.
   *
   * ⚠️ **Deprecation candidate.** Overlaps `user_logged_in` and `user_signed_up`, which
   * already cover both branches with better attribution. Do not use for new analysis;
   * when it is retired, follow the deprecation path in `docs/analytics/metrics.md`
   * (stop emitting → tag `deprecated` → unverify → keep an action bridge if history matters).
   *
   * @property is_new_user {boolean} Whether this callback created the account.
   * @property has_claim_intent {boolean} Whether a claim token accompanied the callback.
   */
  USER_AUTHENTICATED: 'user_authenticated',

  // ---------------------------------------------------------------------------
  // System, performance, and product feedback
  // ---------------------------------------------------------------------------

  /**
   * A site-wide call-to-action was clicked.
   * @property cta_name {string} CTA identifier.
   * @property cta_location {string} Surface hosting the CTA.
   * @property destination_url {string} Href navigated to.
   * @property page_url {string} URL the CTA was clicked from.
   */
  CTA_CLICKED: 'cta_clicked',

  /**
   * An API error surfaced to the user in the UI.
   * @property endpoint {string} Endpoint that failed.
   * @property status_code {number} HTTP status returned.
   * @property user_action {string} What the user was trying to do.
   */
  API_ERROR_SHOWN: 'api_error_shown',

  /**
   * Server-side: a file finished uploading through `/api/upload`.
   * @property bucket {string} Destination storage bucket.
   * @property asset_type {string} `'image'` or `'document'`.
   * @property size_bytes {number} Size of the original uploaded file.
   * @property authenticated {boolean} Whether the uploader was signed in.
   * @property width {number | undefined} Processed image width; images only.
   * @property height {number | undefined} Processed image height; images only.
   */
  ASSET_UPLOADED: 'asset_uploaded',

  /**
   * Server-side: a Turnstile bot challenge was passed.
   * @property has_custom_return_path {boolean} Whether the challenge carried a non-root return path.
   */
  CHALLENGE_VERIFIED: 'challenge_verified',

  /**
   * Core Web Vitals field measurement (LCP / CLS / INP / FCP / TTFB).
   *
   * ⚠️ **Machine-emitted — never behavioural.** This is the highest-volume event in the
   * project by a wide margin and fires without any user intent. It must **never** enter a
   * behavioural funnel, a session-qualification rule, or a raw-total comparison across
   * events; doing so will mislead anyone reading the numbers. Keep it tagged apart and
   * confine it to performance analysis.
   *
   * Caveat on `content_group`: read at *report* time. CLS and INP finalize on page-hide,
   * after any soft navigation, so a metric accrued on one route can be tagged with the
   * content group of the route the user ended on.
   *
   * @property metric_name {string} Vital name (LCP/CLS/INP/FCP/TTFB).
   * @property metric_value {number} Rounded value; ms for all vitals except CLS (unitless, 3dp).
   * @property metric_rating {string} good / needs-improvement / poor.
   * @property metric_delta {number} Change since the last report for this metric id.
   * @property metric_id {string} Per-page-load metric instance id.
   * @property navigation_type {string | null} Navigation type, null when unavailable.
   * @property content_group {string | null} Content group at report time, null on the server.
   */
  WEB_VITAL_REPORTED: 'web_vital_reported',

  /**
   * A product feature request was submitted.
   * @property request_id {string} Feature request id.
   */
  FEATURE_REQUEST_SUBMITTED: 'feature_request_submitted',

  /**
   * A vote on a feature request was cast or withdrawn.
   * @property request_id {string} Feature request id.
   * @property voted {boolean} True when voting, false when withdrawing the vote.
   */
  FEATURE_REQUEST_VOTED: 'feature_request_voted',
} as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS]

/**
 * Property shape for each event, derived from the emitted object literals.
 *
 * Optional keys mark properties that are conditionally spread at the call site — an
 * absent key is a real state in the data, not a modelling convenience. Types here are
 * a contract with historical data: widening or changing one silently breaks every
 * aggregate that spans the change.
 */
export interface AnalyticsEventPayloads {
  // Discovery
  [ANALYTICS_EVENTS.BRAND_LIST_VIEWED]: { list_name: string; item_count: number }
  [ANALYTICS_EVENTS.BRAND_CARD_CLICKED]: {
    brand_id: string
    brand_slug: string
    category: string | null
    position_in_grid: number
  }
  [ANALYTICS_EVENTS.HERO_CATEGORY_CLICKED]: { category: string; destination_url: string }
  [ANALYTICS_EVENTS.DIRECTORY_SORT_CHANGED]: { sort_value: string; previous_sort: string }
  [ANALYTICS_EVENTS.DIRECTORY_PAGE_NAVIGATED]: {
    page_number: number
    direction: string
    total_pages: number
  }
  [ANALYTICS_EVENTS.CATEGORY_FILTER_APPLIED]: { category: string }
  [ANALYTICS_EVENTS.SUBCATEGORY_FILTER_APPLIED]: {
    subcategory: string
    parent_category: string
    result_count: number
  }
  [ANALYTICS_EVENTS.PRICE_FILTER_APPLIED]: { price_range: string }
  [ANALYTICS_EVENTS.VERIFICATION_FILTER_APPLIED]: { status: string }
  [ANALYTICS_EVENTS.FILTER_CLEARED]: {
    clear_type: string
    filter_type?: string
    filter_value?: string
  }
  [ANALYTICS_EVENTS.LANGUAGE_SWITCHED]: {
    from_locale: string
    to_locale: string
    location: string
  }

  // Brand detail
  [ANALYTICS_EVENTS.BRAND_DETAIL_VIEWED]: {
    brand_id: string
    brand_slug: string
    source: 'search' | 'category' | 'directory' | 'direct' | 'recommendation'
  }
  [ANALYTICS_EVENTS.BRAND_DETAIL_ENGAGED]: {
    brand_slug: string
    trigger: 'dwell' | 'gallery' | 'faq' | 'channel' | 'scroll_50'
    brand_id?: string
  }
  [ANALYTICS_EVENTS.EXTERNAL_LINK_CLICKED]: {
    brand_id: string
    brand_slug: string
    link_type: string
    /** Named `link_surface`, NOT `surface`: the before_send scrubber overwrites a top-level `surface` with 'public' | 'product' on every event. */
    link_surface: 'detail_page' | 'card' | 'recommendation'
  }
  [ANALYTICS_EVENTS.BRAND_PAGE_SHARED]: {
    brand_id?: string
    brand_slug: string
    method?: string
  }
  [ANALYTICS_EVENTS.GALLERY_PHOTO_VIEWED]: {
    brand_id: string
    brand_slug: string
    photo_index: number
  }
  [ANALYTICS_EVENTS.GALLERY_COMPLETED]: {
    brand_id: string
    brand_slug: string
    image_count: number
  }
  [ANALYTICS_EVENTS.FAQ_ITEM_EXPANDED]: { brand_slug: string; item_index: number }
  [ANALYTICS_EVENTS.RECOMMENDATION_BRAND_CLICKED]: {
    brand_id: string
    brand_slug: string
    source_brand_slug: string
    position: number
  }
  [ANALYTICS_EVENTS.RECOMMENDATION_SECTION_VIEWED]: {
    source_brand_slug: string
    recommendation_count: number
  }

  // Search
  [ANALYTICS_EVENTS.BRAND_SEARCH_EXECUTED]: {
    query_length: number
    result_count: number
    has_results: boolean
  }
  [ANALYTICS_EVENTS.BRAND_SEARCH_EMPTY]: { query_length: number }
  [ANALYTICS_EVENTS.SEARCH_RESULT_CLICKED]: {
    query_length: number
    position_in_results: number
    brand_id: string
    brand_slug: string
  }
  [ANALYTICS_EVENTS.SEARCH_SUGGESTION_SELECTED]: { brand_id: string; brand_slug: string }

  // Saved / liked
  [ANALYTICS_EVENTS.BRAND_SAVED]: {
    brand_id: string
    brand_slug: string
    location: string
  }
  [ANALYTICS_EVENTS.SAVED_BRAND_REVISITED]: {
    brand_slug: string
    /** Named `revisit_surface`, NOT `surface` — see EXTERNAL_LINK_CLICKED.link_surface. */
    revisit_surface: 'card' | 'detail_page'
    brand_id?: string
  }
  [ANALYTICS_EVENTS.BRAND_UNSAVED]: {
    brand_id: string
    brand_slug: string
    location: string
  }
  [ANALYTICS_EVENTS.BRAND_LIKED]: {
    brand_id: string
    brand_slug: string
    location: string
  }
  [ANALYTICS_EVENTS.BRAND_UNLIKED]: {
    brand_id: string
    brand_slug: string
    location: string
  }

  // Submission funnel
  [ANALYTICS_EVENTS.SUBMISSION_FORM_OPENED]: {
    source: 'header_cta' | 'hero_cta' | 'footer_link' | 'quick'
    intent: 'recommend' | 'owner_claim'
  }
  [ANALYTICS_EVENTS.SUBMISSION_PATH_SELECTED]: UtmProperties & {
    path: string
    is_authenticated: boolean
  }
  [ANALYTICS_EVENTS.SUBMISSION_FORM_STEP_COMPLETED]: { step: string }
  [ANALYTICS_EVENTS.SUBMISSION_COMPLETED]: UtmProperties & {
    category: string
    has_logo: boolean
    time_spent_seconds: number
    intent: 'recommend' | 'owner_claim'
    guest_submission: boolean
  }
  [ANALYTICS_EVENTS.SUBMISSION_FORM_ABANDONED]: {
    last_step_completed: string
    time_spent_seconds: number
  }
  [ANALYTICS_EVENTS.SUBMISSION_FORM_ERROR_SHOWN]: {
    field: string
    error_type: string
    step: string
  }
  [ANALYTICS_EVENTS.NEWSLETTER_SUBSCRIBED]: UtmProperties & {
    interests: string[]
    has_email: boolean
  }

  // Claim / supply
  [ANALYTICS_EVENTS.BRAND_CLAIM_STARTED]: {
    brand_id: string
    brand_slug: string
    is_authenticated: boolean
  }
  [ANALYTICS_EVENTS.BRAND_CLAIM_FORM_SUBMITTED]: {
    brand_id: string
    brand_slug: string
    proof_types: string[]
  }
  [ANALYTICS_EVENTS.BRAND_CLAIM_COMPLETED]: { brand_id: string; is_new_user: boolean }
  [ANALYTICS_EVENTS.BRAND_CLAIM_APPROVED]: {
    brand_id: string
    brand_slug?: string
    claim_request_id: string
  }
  [ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED]: {
    brand_id: string
    brand_slug: string
    is_brand_owner: boolean
  }
  [ANALYTICS_EVENTS.BRAND_OWNER_EDIT_PUBLISHED]: { brand_id: string; brand_slug: string }
  [ANALYTICS_EVENTS.MIT_DECLARED]: {
    brand_id: string
    brand_slug: string
    declared_scope: string
  }
  [ANALYTICS_EVENTS.ORIGIN_EVIDENCE_SUBMITTED]: {
    brand_id: string
    brand_slug: string
    stance: string
  }
  [ANALYTICS_EVENTS.BRAND_REPORTED]: {
    brand_slug: string
    reason: string
    reporter_role: string
  }
  [ANALYTICS_EVENTS.BRAND_CORRECTION_SUBMITTED]: {
    brand_id: string
    brand_slug: string
    field: string
  }

  // Auth
  [ANALYTICS_EVENTS.USER_SIGNED_UP]: UtmProperties & { method: string }
  [ANALYTICS_EVENTS.USER_LOGGED_IN]: { method: string }
  [ANALYTICS_EVENTS.USER_SIGNED_OUT]: Record<string, never>
  [ANALYTICS_EVENTS.USER_AUTHENTICATED]: {
    is_new_user: boolean
    has_claim_intent: boolean
  }

  // System
  [ANALYTICS_EVENTS.CTA_CLICKED]: {
    cta_name: string
    cta_location: string
    destination_url: string
    page_url: string
  }
  [ANALYTICS_EVENTS.API_ERROR_SHOWN]: {
    endpoint: string
    status_code: number
    user_action: string
  }
  [ANALYTICS_EVENTS.ASSET_UPLOADED]: {
    bucket: string
    asset_type: 'image' | 'document'
    size_bytes: number
    authenticated: boolean
    width?: number
    height?: number
  }
  [ANALYTICS_EVENTS.CHALLENGE_VERIFIED]: { has_custom_return_path: boolean }
  [ANALYTICS_EVENTS.WEB_VITAL_REPORTED]: {
    metric_name: string
    metric_value: number
    metric_rating: string
    metric_delta: number
    metric_id: string
    navigation_type: string | null
    content_group: string | null
  }
  [ANALYTICS_EVENTS.FEATURE_REQUEST_SUBMITTED]: { request_id: string }
  [ANALYTICS_EVENTS.FEATURE_REQUEST_VOTED]: { request_id: string; voted: boolean }
}
