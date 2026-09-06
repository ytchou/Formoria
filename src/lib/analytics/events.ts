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
interface UtmProperties {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
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
  BRAND_LIST_VIEWED: "brand_list_viewed",

  /**
   * A brand card in a list was clicked through to the brand detail page.
   * Excludes the recommendation-card variant, which emits `recommendation_brand_clicked`.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property category {string | null} Primary category of the clicked brand, null when unset.
   * @property position_in_grid {number} 0-based position of the card within the rendered grid.
   * @property list_source {string | undefined} Stable list identifier, when the card belongs to a named rail.
   */
  BRAND_CARD_CLICKED: "brand_card_clicked",

  /**
   * A booth block was selected in the Creative Expo floor map.
   * @deprecated Retired 2026-08-24: the interactive floor map was removed. Historical
   * PostHog rows remain directly queryable (3 events from 1 person; last seen 2026-08-07).
   * @property booth {string} Canonical booth code.
   * @property zone {string} Expo zone containing the booth.
   * @property brand_count {number} Linked brands represented by the booth.
   * @property event_slug {string} Event owning the floor map.
   */
  BOOTH_SELECTED: "booth_selected",

  /**
   * An exhibitor's own website was opened from the event exhibitor list.
   * Distinct from `external_link_clicked`, which is keyed on a brand and only fires
   * for brands in the directory — most exhibitors in a hall are not listed by us.
   * @property source_key {string} Canonical exhibitor key in the event roster.
   * @property event_slug {string} Event owning the exhibitor list.
   * @property booth {string | null} Booth code, null when the roster has none.
   * @property brand_slug {string | null} Linked Formoria brand, null when unlisted.
   */
  EXHIBITOR_SITE_CLICKED: "exhibitor_site_clicked",

  /**
   * A category tile in the homepage hero was clicked.
   * @deprecated Retired 2026-08-24: the final production caller was removed. Historical
   * PostHog rows remain directly queryable (60 events from 21 people; last seen 2026-08-16).
   * @property category {string} Category key.
   * @property destination_url {string} Resolved href the tile navigates to.
   */
  HERO_CATEGORY_CLICKED: "hero_category_clicked",

  /**
   * A curated product tile was opened.
   * @property product_key {string} Stable key of the selected product.
   * @property brand_slug {string} Slug of the brand owning the product.
   * @property position {number} 0-based position within the rendered selection rail.
   * @property selection_surface {string} Stable surface identifier for the selection rail.
   */
  CURATED_PRODUCT_CLICKED: "curated_product_clicked",

  /**
   * An editorial story card was opened.
   * @property story_slug {string} Stable slug of the story.
   * @property position {number} 0-based position within the rendered story list.
   * @property story_surface {string} Stable surface identifier for the story list.
   */
  STORY_CARD_CLICKED: "story_card_clicked",

  /**
   * A Discovery Trail card or row was opened.
   * @property trail_slug {string} Stable slug of the trail.
   * @property position {number} 0-based position within the rendered trail surface.
   * @property trail_surface {string} Stable surface identifier for the trail list.
   */
  TRAIL_CARD_CLICKED: "trail_card_clicked",

  /**
   * A category card on a 404 page was clicked.
   * @property category_slug {string} Slug of the clicked category.
   * @property position {number} 0-based position within the grid.
   */
  NOT_FOUND_CATEGORY_CLICKED: "not_found_category_clicked",

  /**
   * The directory sort control changed value.
   * @property sort_value {string} Newly selected sort key.
   * @property previous_sort {string} Sort key in effect before the change.
   */
  DIRECTORY_SORT_CHANGED: "directory_sort_changed",

  /**
   * The directory pager moved to another page.
   * @property page_number {number} Destination page (1-based).
   * @property direction {string} Navigation direction / control used.
   * @property total_pages {number} Total pages in the current result set.
   */
  DIRECTORY_PAGE_NAVIGATED: "directory_page_navigated",

  /**
   * A top-level category filter was applied.
   * No `result_count`: no facet count is available at click time for this control.
   * @property category {string} Category key applied.
   */
  CATEGORY_FILTER_APPLIED: "category_filter_applied",

  /**
   * A subcategory chip filter was applied. The only filter event carrying `result_count`,
   * because the facet count is already rendered on the chip and known before navigation.
   * @property subcategory {string} Subcategory key applied.
   * @property parent_category {string} Parent category of the subcategory.
   * @property result_count {number} Post-filter brand count from the chip facet; always an integer.
   */
  SUBCATEGORY_FILTER_APPLIED: "subcategory_filter_applied",

  /**
   * A product subcategory filter was applied on the discover page.
   * @property subcategory {string} Subcategory key applied.
   * @property parent_category {string} Parent category of the subcategory.
   * @property result_count {number} Post-filter product count; always an integer.
   */
  PRODUCT_SUBCATEGORY_FILTER_APPLIED: "product_subcategory_filter_applied",

  /**
   * A material filter was applied on the discover page.
   * @property material {string} Material key applied.
   * @property result_count {number} Post-filter product count; always an integer.
   */
  PRODUCT_MATERIAL_FILTER_APPLIED: "product_material_filter_applied",

  /**
   * The product sort control changed value on the discover page.
   * @property sort_value {string} Newly selected sort key.
   * @property previous_sort {string} Sort key in effect before the change.
   */
  PRODUCT_SORT_CHANGED: "product_sort_changed",

  /**
   * A price-range filter was applied.
   * @deprecated Retired 2026-08-24 with the price-range facet. The event name
   * and payload remain in this permanent analytics ledger for historical rows.
   * @property price_range {string} Price bucket key.
   */
  PRICE_FILTER_APPLIED: "price_filter_applied",

  /**
   * A manufacturing-verification tier filter was applied.
   * No `result_count`: no facet count is available at click time for this control.
   * @property status {string} Verification tier key.
   */

  /**
   * A filter was cleared — either one chip or the whole set.
   * @property clear_type {string} Scope of the clear (single filter vs clear-all).
   * @property filter_type {string | undefined} Which filter was cleared; absent on clear-all.
   * @property filter_value {string | undefined} Value that was cleared; absent on clear-all.
   */
  FILTER_CLEARED: "filter_cleared",

  /**
   * The site locale was switched.
   * @property from_locale {string} Locale before the switch.
   * @property to_locale {string} Locale after the switch.
   * @property location {string} UI surface hosting the switcher.
   */
  LANGUAGE_SWITCHED: "language_switched",

  // ---------------------------------------------------------------------------
  // Brand detail — views, engagement depth, media, sharing, outbound
  // ---------------------------------------------------------------------------

  /**
   * A brand detail page was viewed. Widest-reach behavioural event; the real top of funnel.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property source {string} How the visitor arrived: search / category / directory / direct / recommendation.
   */
  BRAND_DETAIL_VIEWED: "brand_detail_viewed",

  /**
   * First qualifying signal that a visitor genuinely engaged with a brand page,
   * rather than bouncing. Emitted at most once per page view, on the first trigger.
   * This is the engagement qualification gate for the north-star metric.
   * @property brand_slug {string} Brand slug.
   * @property trigger {string} Which signal qualified: dwell (>=15s) / gallery / faq / scroll_50.
   * @property brand_id {string | undefined} Brand UUID; omitted when unavailable at emit time.
   */
  BRAND_DETAIL_ENGAGED: "brand_detail_engaged",

  /**
   * An outbound link to a brand's own site or purchase channel was clicked.
   * The primary conversion proxy. Defensible as an observable proxy, never as a raw count
   * (see `docs/analytics/metrics.md` §Validity caveats).
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property link_type {string} Kind of destination (official site, marketplace, social, …).
   * @property surface {string} Where the click happened: detail_page / card / recommendation.
   */
  EXTERNAL_LINK_CLICKED: "external_link_clicked",

  /**
   * The brand page share dialog completed a share through a channel.
   * @property brand_id {string | undefined} Brand UUID; omitted when unavailable.
   * @property brand_slug {string} Brand slug.
   * @property method {string | undefined} Share channel; `'x'` appears in history only (retired DEV-1242).
   */
  BRAND_PAGE_SHARED: "brand_page_shared",

  /**
   * A photo in the brand gallery was opened or advanced to.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property photo_index {number} 0-based index of the photo viewed.
   */
  GALLERY_PHOTO_VIEWED: "gallery_photo_viewed",

  /**
   * The visitor reached the end of a brand's gallery.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property image_count {number} Total images in the gallery.
   */
  GALLERY_COMPLETED: "gallery_completed",

  /**
   * An FAQ item on a brand page was expanded.
   * @property brand_slug {string} Brand slug.
   * @property preset_id {string} Stable preset id of the expanded item.
   */
  FAQ_ITEM_EXPANDED: "faq_item_expanded",

  /**
   * A brand in the "you may also like" section was clicked.
   * @property brand_id {string} Destination brand UUID.
   * @property brand_slug {string} Destination brand slug.
   * @property source_brand_slug {string} Slug of the brand page hosting the recommendation.
   * @property position {number} 0-based position within the recommendation row.
   */
  RECOMMENDATION_BRAND_CLICKED: "recommendation_brand_clicked",

  /**
   * The recommendation section scrolled into view on a brand page.
   * @property source_brand_slug {string} Slug of the hosting brand page.
   * @property recommendation_count {number} Number of recommendations rendered.
   */
  RECOMMENDATION_SECTION_VIEWED: "recommendation_section_viewed",

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * A brand search ran.
   * @property query_length {number} Character length of the query.
   * @property result_count {number} Number of results returned.
   * @property has_results {boolean} Whether the query returned anything.
   * @property search_term {string | undefined} The query text, trimmed and capped at 100
   *   characters. Added DEV-1408, reversing the original exclusion. Absent — not empty —
   *   when the query looked like an email address or contained a run of 7+ digits.
   *   Historical rows before that deploy carry no `search_term` at all.
   */
  BRAND_SEARCH_EXECUTED: "brand_search_executed",

  /**
   * A product search ran (on the `/discover?q=` surface).
   * @property query_length {number} Character length of the query.
   * @property result_count {number} Number of product results returned.
   * @property has_results {boolean} Whether the query returned anything.
   * @property search_term {string | undefined} The query text, trimmed and capped at 100
   *   characters. Absent when the query looked like an email address or contained a run
   *   of 7+ digits.
   * @property search_source {string} Where the search originated: `discover_page` | `url`.
   * @property degraded {boolean} Whether the search fell back to lexical-only mode.
   */
  PRODUCT_SEARCH_EXECUTED: "product_search_executed",

  /**
   * A search returned zero results. Denominator partner of `brand_search_executed`
   * for the query success rate, and the catalog-gap signal: `search_term` on this event
   * names what the directory failed to stock.
   * @property query_length {number} Character length of the query.
   * @property search_term {string | undefined} Same shape and caveats as on
   *   `brand_search_executed`.
   */
  BRAND_SEARCH_EMPTY: "brand_search_empty",

  /**
   * A result on the search results page was clicked.
   * @property query_length {number} Character length of the query.
   * @property position_in_results {number} 0-based rank of the clicked result.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   */
  SEARCH_RESULT_CLICKED: "search_result_clicked",

  /**
   * A typeahead suggestion in the search box was selected.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   */
  SEARCH_SUGGESTION_SELECTED: "search_suggestion_selected",

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
  BRAND_SAVED: "brand_saved",

  /**
   * A previously saved brand was returned to. Strongest return-with-intent signal.
   * @property brand_slug {string} Brand slug.
   * @property surface {string} Where the revisit started: card / detail_page.
   * @property brand_id {string | undefined} Brand UUID; omitted when unavailable at emit time.
   */
  SAVED_BRAND_REVISITED: "saved_brand_revisited",

  /**
   * A brand was removed from the visitor's saved list.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property location {string} UI surface the unsave was triggered from.
   */
  BRAND_UNSAVED: "brand_unsaved",

  /**
   * A curated product was saved/bookmarked.
   * @property product_id {string} Product UUID.
   * @property product_key {string} Product key slug.
   * @property location {string} UI surface the save was triggered from.
   */
  PRODUCT_SAVED: "product_saved",

  /**
   * A curated product was removed from the visitor's saved list.
   * @property product_id {string} Product UUID.
   * @property product_key {string} Product key slug.
   * @property location {string} UI surface the unsave was triggered from.
   */
  PRODUCT_UNSAVED: "product_unsaved",

  // ---------------------------------------------------------------------------
  // Submission funnel
  // ---------------------------------------------------------------------------

  /**
   * The submission form was opened.
   * @property source {string} Entry point: header_cta / hero_cta / footer_link / quick.
   * @property intent {string} Normalized intent: recommend.
   */
  SUBMISSION_FORM_OPENED: "submission_form_opened",

  /**
   * The submitter chose a submission path on the intent chooser.
   * @property path {string} Chosen path key.
   * @property is_authenticated {boolean} Whether the visitor was signed in.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  SUBMISSION_PATH_SELECTED: "submission_path_selected",

  /**
   * A step of the multi-step submission form was completed.
   * @property step {string} Step identifier.
   */
  SUBMISSION_FORM_STEP_COMPLETED: "submission_form_step_completed",

  /**
   * A brand submission was successfully created. Brand name is deliberately not sent
   * to PostHog (GA only) to keep pre-moderation names out of the event stream.
   * @property category {string} Selected category.
   * @property has_logo {boolean} Whether a logo was uploaded.
   * @property time_spent_seconds {number} Wall-clock seconds from form open to submit.
   * @property intent {string} recommend.
   * @property guest_submission {boolean} Whether the submitter was unauthenticated.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  SUBMISSION_COMPLETED: "submission_completed",

  /**
   * The submission form was left without completing.
   * @property last_step_completed {string} Last step the submitter finished.
   * @property time_spent_seconds {number} Wall-clock seconds before abandonment.
   */
  SUBMISSION_FORM_ABANDONED: "submission_form_abandoned",

  /**
   * A validation error was displayed inside the submission form.
   * @property field {string} Field that failed.
   * @property error_type {string} Validation failure kind.
   * @property step {string} Step the error occurred on.
   */
  SUBMISSION_FORM_ERROR_SHOWN: "submission_form_error_shown",

  /**
   * The newsletter opt-in was submitted.
   * @property interests {string[]} Selected interest keys.
   * @property has_email {boolean} Whether an email address was supplied.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  NEWSLETTER_SUBSCRIBED: "newsletter_subscribed",

  // ---------------------------------------------------------------------------
  // Supply side and moderation outcomes
  // ---------------------------------------------------------------------------

  /**
   * Server-side: a submitted brand was approved and published. Machine/inventory
   * telemetry uses the reserved service identity, not the submitter. Covers both
   * single and bulk approval.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property is_brand_owner {boolean} Whether the submitter is the brand's owner.
   * @property $process_person_profile {false} Prevents this machine/inventory event from creating a person profile.
   */
  BRAND_LISTING_PUBLISHED: "brand_listing_published",

  /**
   * A brand listing was reported by a visitor or owner.
   * @property brand_slug {string} Brand slug.
   * @property reason {string} Report reason key.
   * @property reporter_role {string} Role of the reporter.
   */
  BRAND_REPORTED: "brand_reported",

  /**
   * A correction to a brand field was suggested.
   * @property brand_id {string} Brand UUID.
   * @property brand_slug {string} Brand slug.
   * @property field {string} Field the correction targets.
   */
  BRAND_CORRECTION_SUBMITTED: "brand_correction_submitted",

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /**
   * A new account was created.
   * @property method {string} Auth method used.
   * @property utm_* {string | undefined} UTM params present on the current URL.
   */
  USER_SIGNED_UP: "user_signed_up",

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
  USER_LOGGED_IN: "user_logged_in",

  /**
   * A user signed out. Emitted through `resetPostHogUser()` as the final buffered
   * capture, so it survives the identity reset.
   */
  USER_SIGNED_OUT: "user_signed_out",

  /**
   * Server-side: the auth callback resolved a session.
   *
   * ⚠️ **Deprecation candidate.** Overlaps `user_logged_in` and `user_signed_up`, which
   * already cover both branches with better attribution. Do not use for new analysis;
   * when it is retired, follow the deprecation path in `docs/analytics/metrics.md`
   * (stop emitting → tag `deprecated` → unverify → keep an action bridge if history matters).
   *
   * @property is_new_user {boolean} Whether this callback created the account.
   */
  USER_AUTHENTICATED: "user_authenticated",

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
  CTA_CLICKED: "cta_clicked",

  /**
   * An API error surfaced to the user in the UI.
   * @deprecated Retired 2026-08-24 after the unused emitter was removed. No PostHog rows
   * were ever ingested; the permanent ledger entry preserves the payload contract.
   * @property endpoint {string} Endpoint that failed.
   * @property status_code {number} HTTP status returned.
   * @property user_action {string} What the user was trying to do.
   */
  API_ERROR_SHOWN: "api_error_shown",

  /**
   * Server-side: a file finished uploading through `/api/upload`.
   * @property bucket {string} Destination storage bucket.
   * @property asset_type {string} `'image'` or `'document'`.
   * @property size_bytes {number} Size of the original uploaded file.
   * @property authenticated {boolean} Whether the uploader was signed in.
   * @property width {number | undefined} Processed image width; images only.
   * @property height {number | undefined} Processed image height; images only.
   */
  ASSET_UPLOADED: "asset_uploaded",

  /**
   * Server-side: a Turnstile bot challenge was passed.
   * @property has_custom_return_path {boolean} Whether the challenge carried a non-root return path.
   */
  CHALLENGE_VERIFIED: "challenge_verified",

  /**
   * Server-side: the rate limiter could not reach its backing store and opened
   * its fail-open breaker. The name deliberately matches the `console.error`
   * line in `security/rate-limiter.ts`, so the log and the event are one signal.
   * Emitted from the edge runtime, where Sentry cannot see anything.
   * @property error_message {string} Message from the store rejection (e.g. an Upstash quota error).
   * @property cooldown_ms {number} How long the breaker stays open before re-probing.
   */
  RATE_LIMIT_STORE_UNAVAILABLE: "rate_limit_store_unavailable",

  /**
   * Server-side: the rate-limit breaker closed and the store is being dialled again.
   * @property cooldown_ms {number} Breaker cooldown window that elapsed.
   * @property outage_ms {number} Time between the breaker opening and closing.
   */
  RATE_LIMIT_STORE_RECOVERED: "rate_limit_store_recovered",

  /**
   * Server-side: a request was blocked by the rate limiter (hard 429) or sent
   * to the Turnstile challenge by the soft limiter.
   *
   * Covers ALL blocked traffic, not just registry-matched crawlers -- the
   * pre-existing signal (`crawler-drift.ts` -> Sentry) only fires when a
   * User-Agent matches the crawler registry, so unrecognised clients, the
   * majority of what a limiter blocks, produced nothing at all. Enforcement
   * thresholds are calibrated against this event.
   *
   * Never carries a raw IP: `ip_key` is a non-reversible hash, enough to count
   * distinct blocked clients and no more.
   * @property route_family {string} Coarse route bucket the rule matched (e.g. `/brands`).
   * @property ip_key {string} Non-reversible hash of the client IP.
   * @property reason {string} Reason code: `hard_limit_exceeded`, `soft_limit_challenge` or `verified_budget_exhausted`.
   */
  RATE_LIMIT_BLOCKED: "rate_limit_blocked",

  /**
   * ENFORCEMENT LADDER (DEV-1551). Eleven events covering every rung and every
   * state of the anti-enumeration ladder in `security/enforcement.ts`.
   *
   * The ladder ships in log-only `observe` mode, so these events are its ONLY
   * output until thresholds have been calibrated against them. Alert
   * thresholds, the rollback trigger, and what a false-positive spike looks
   * like are recorded in `docs/runbooks/anti-enumeration.md`.
   *
   * PRIVACY CONTRACT: none of the eleven may ever carry a raw IP or a raw
   * `fm_visitor` id. `identity_key` is a non-reversible hash
   * (`pseudonymizeIdentifier`), enough to count distinct clients and no more.
   * A test in `rate-limit-observability.test.ts` enforces this.
   *
   * Every ladder event shares the same property set:
   * @property identity_key {string} Non-reversible hash of the scored identity.
   * @property identity_kind {string} Which tier scored: `user`, `visitor` or `ip`.
   * @property route_family {string} Route family from `security/route-family.ts`.
   * @property distinct_resources {number} Distinct resources seen in the window.
   * @property window {string} Traversal window: `burst`, `tenMinutes` or `hour`.
   * @property threshold {number} The scaled threshold that was compared against.
   * @property reason {string} Machine-readable reason code from `ENFORCEMENT_REASONS`.
   * @property action {string} The rung the ladder concluded.
   * @property effective_action {string} What the request actually experienced.
   * @property mode {string} `observe` or `enforce`.
   */
  /**
   * Rung 1: above the noise floor, still served. There is deliberately NO
   * event for rung 0 -- an `allow` fires on every request on the site, and the
   * denominator is already available from pageview volume.
   */
  SCRAPE_LADDER_RECORDED: "scrape_ladder_recorded",
  /** Rung 2: sent through Turnstile. */
  SCRAPE_LADDER_CHALLENGED: "scrape_ladder_challenged",
  /** Rung 3: 429 for the standard block window. */
  SCRAPE_LADDER_BLOCKED: "scrape_ladder_blocked",
  /** Rung 4: 429 for the longer window, after the standard one did not help. */
  SCRAPE_LADDER_EXTENDED_BLOCK: "scrape_ladder_extended_block",
  /**
   * The ladder concluded a non-allow rung but `observe` mode suppressed it.
   * Fires alongside the rung event, so "how much would we block if we flipped
   * the switch?" is answerable without filtering on `mode`.
   */
  SCRAPE_LADDER_SHADOWED: "scrape_ladder_shadowed",
  /**
   * A Turnstile-verified visitor exhausted the RAISED budget. Verification is a
   * multiplier, never an exemption -- this event is the proof it stayed finite.
   */
  SCRAPE_VERIFIED_BUDGET_EXHAUSTED: "scrape_verified_budget_exhausted",
  /**
   * A pseudonymous IP key is producing repeated fresh `fm_visitor` identities.
   * Cookie rotation is the cheapest evasion, so this is the signal that
   * IP-tier accounting is the thing actually holding.
   * @property identity_key {string} Non-reversible hash of the IP tier.
   * @property route_family {string} Route family the rotation was seen on.
   * @property reason {string} Machine-readable reason code.
   */
  SCRAPE_IDENTITY_ROTATION_SUSPECTED: "scrape_identity_rotation_suspected",
  /**
   * A Cloudflare-verified crawler took the exemption. Paired with
   * its blocked counterpart: together they say whether the verified-bot
   * transform rule is live, which gates flipping `VERIFIED_CRAWLER_SHADOW`.
   * @property crawler_name {string | null} Registry entry name, when matched.
   * @property route_family {string} Route family the request was on.
   * @property reason {string} Machine-readable reason code.
   */
  VERIFIED_CRAWLER_ALLOWED: "verified_crawler_allowed",
  /**
   * THE DEINDEXING ALARM. A registry crawler was blocked or challenged.
   * Sustained volume here means search engines are being turned away from
   * `/brands/*`, which is the outcome this whole subsystem exists to avoid.
   * @property crawler_name {string} Registry entry name.
   * @property route_family {string} Route family the request was on.
   * @property reason {string} Machine-readable reason code.
   */
  KNOWN_CRAWLER_BLOCKED: "known_crawler_blocked",
  /**
   * A fresh `fm_visitor` was minted because none arrived or the signature did
   * not verify. One per genuine first visit; a stream of them from one IP key
   * is deliberate rotation.
   * @property identity_key {string} Non-reversible hash of the client.
   * @property route_family {string} Route family the mint happened on.
   * @property reason {string} Machine-readable reason code.
   */
  VISITOR_IDENTITY_ROTATED: "visitor_identity_rotated",
  /**
   * The ladder ran on the DEGRADED in-memory store, or with counters disabled.
   * Distinct from `rate_limit_store_unavailable` (the hard limiter's breaker):
   * this one says the enumeration numbers being alerted on are per-isolate
   * fractions and must not be trusted.
   * @property reason {string} Why the ladder is degraded.
   * @property store_kind {string} `in-memory` or `disabled`.
   */
  RATE_LIMITER_DEGRADED: "rate_limiter_degraded",

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
  WEB_VITAL_REPORTED: "web_vital_reported",
} as const;

/**
 * Property shape for each event, derived from the emitted object literals.
 *
 * Optional keys mark properties that are conditionally spread at the call site — an
 * absent key is a real state in the data, not a modelling convenience. Types here are
 * a contract with historical data: widening or changing one silently breaks every
 * aggregate that spans the change.
 */
/**
 * Shared by the seven enforcement-ladder events. One shape on purpose: an
 * operator comparing rungs in PostHog must be able to break every one of them
 * down by the same properties.
 */
interface ScrapeLadderPayload {
  /** Non-reversible hash. NEVER a raw IP or a raw `fm_visitor` id. */
  identity_key: string;
  identity_kind: "user" | "visitor" | "ip";
  route_family: string;
  distinct_resources: number;
  window: string;
  threshold: number;
  reason: string;
  action: string;
  effective_action: string;
  mode: "observe" | "enforce";
  $process_person_profile: false;
}

export interface AnalyticsEventPayloads {
  // Discovery
  [ANALYTICS_EVENTS.BRAND_LIST_VIEWED]: {
    list_name: string;
    item_count: number;
  };
  [ANALYTICS_EVENTS.BRAND_CARD_CLICKED]: {
    brand_id: string;
    brand_slug: string;
    category: string | null;
    position_in_grid: number;
    list_source?: string;
  };
  [ANALYTICS_EVENTS.BOOTH_SELECTED]: {
    booth: string;
    zone: string;
    brand_count: number;
    event_slug: string;
  };
  [ANALYTICS_EVENTS.EXHIBITOR_SITE_CLICKED]: {
    source_key: string;
    event_slug: string;
    booth: string | null;
    brand_slug: string | null;
  };
  [ANALYTICS_EVENTS.HERO_CATEGORY_CLICKED]: {
    category: string;
    destination_url: string;
  };
  [ANALYTICS_EVENTS.CURATED_PRODUCT_CLICKED]: {
    product_key: string;
    brand_slug: string;
    position: number;
    selection_surface: string;
  };
  [ANALYTICS_EVENTS.STORY_CARD_CLICKED]: {
    story_slug: string;
    position: number;
    story_surface: string;
  };
  [ANALYTICS_EVENTS.TRAIL_CARD_CLICKED]: {
    trail_slug: string;
    position: number;
    trail_surface: string;
  };
  [ANALYTICS_EVENTS.NOT_FOUND_CATEGORY_CLICKED]: {
    category_slug: string;
    position: number;
  };
  [ANALYTICS_EVENTS.DIRECTORY_SORT_CHANGED]: {
    sort_value: string;
    previous_sort: string;
  };
  [ANALYTICS_EVENTS.DIRECTORY_PAGE_NAVIGATED]: {
    page_number: number;
    direction: string;
    total_pages: number;
  };
  [ANALYTICS_EVENTS.CATEGORY_FILTER_APPLIED]: { category: string };
  [ANALYTICS_EVENTS.SUBCATEGORY_FILTER_APPLIED]: {
    subcategory: string;
    parent_category: string;
    result_count: number;
  };
  [ANALYTICS_EVENTS.PRODUCT_SUBCATEGORY_FILTER_APPLIED]: {
    subcategory: string;
    parent_category: string;
    result_count: number;
  };
  [ANALYTICS_EVENTS.PRODUCT_MATERIAL_FILTER_APPLIED]: {
    material: string;
    result_count: number;
  };
  [ANALYTICS_EVENTS.PRODUCT_SORT_CHANGED]: {
    sort_value: string;
    previous_sort: string;
  };
  [ANALYTICS_EVENTS.PRICE_FILTER_APPLIED]: { price_range: string };
  [ANALYTICS_EVENTS.FILTER_CLEARED]: {
    clear_type: string;
    filter_type?: string;
    filter_value?: string;
  };
  [ANALYTICS_EVENTS.LANGUAGE_SWITCHED]: {
    from_locale: string;
    to_locale: string;
    location: string;
  };

  // Brand detail
  [ANALYTICS_EVENTS.BRAND_DETAIL_VIEWED]: {
    brand_id: string;
    brand_slug: string;
    source: "search" | "category" | "directory" | "direct" | "recommendation";
  };
  [ANALYTICS_EVENTS.BRAND_DETAIL_ENGAGED]: {
    brand_slug: string;
    trigger: "dwell" | "gallery" | "faq" | "scroll_50";
    brand_id?: string;
  };
  [ANALYTICS_EVENTS.EXTERNAL_LINK_CLICKED]: {
    brand_id: string;
    brand_slug: string;
    link_type: string;
    /** Named `link_surface`, NOT `surface`: the before_send scrubber overwrites a top-level `surface` with 'public' | 'product' on every event. */
    link_surface:
      "detail_page" | "card" | "recommendation" | "selected_product";
  };
  [ANALYTICS_EVENTS.BRAND_PAGE_SHARED]: {
    brand_id?: string;
    brand_slug: string;
    method?: string;
  };
  [ANALYTICS_EVENTS.GALLERY_PHOTO_VIEWED]: {
    brand_id: string;
    brand_slug: string;
    photo_index: number;
  };
  [ANALYTICS_EVENTS.GALLERY_COMPLETED]: {
    brand_id: string;
    brand_slug: string;
    image_count: number;
  };
  [ANALYTICS_EVENTS.FAQ_ITEM_EXPANDED]: {
    brand_slug: string;
    preset_id: string;
  };
  [ANALYTICS_EVENTS.RECOMMENDATION_BRAND_CLICKED]: {
    brand_id: string;
    brand_slug: string;
    source_brand_slug: string;
    position: number;
  };
  [ANALYTICS_EVENTS.RECOMMENDATION_SECTION_VIEWED]: {
    source_brand_slug: string;
    recommendation_count: number;
  };

  // Search
  [ANALYTICS_EVENTS.BRAND_SEARCH_EXECUTED]: {
    query_length: number;
    result_count: number;
    has_results: boolean;
  };
  [ANALYTICS_EVENTS.PRODUCT_SEARCH_EXECUTED]: {
    query_length: number;
    result_count: number;
    has_results: boolean;
    search_source: string;
    degraded: boolean;
  };
  [ANALYTICS_EVENTS.BRAND_SEARCH_EMPTY]: { query_length: number };
  [ANALYTICS_EVENTS.SEARCH_RESULT_CLICKED]: {
    query_length: number;
    position_in_results: number;
    brand_id: string;
    brand_slug: string;
  };
  [ANALYTICS_EVENTS.SEARCH_SUGGESTION_SELECTED]: {
    brand_id: string;
    brand_slug: string;
  };

  // Saved / liked
  [ANALYTICS_EVENTS.BRAND_SAVED]: {
    brand_id: string;
    brand_slug: string;
    location: string;
  };
  [ANALYTICS_EVENTS.SAVED_BRAND_REVISITED]: {
    brand_slug: string;
    /** Named `revisit_surface`, NOT `surface` — see EXTERNAL_LINK_CLICKED.link_surface. */
    revisit_surface: "card" | "detail_page";
    brand_id?: string;
  };
  [ANALYTICS_EVENTS.BRAND_UNSAVED]: {
    brand_id: string;
    brand_slug: string;
    location: string;
  };
  [ANALYTICS_EVENTS.PRODUCT_SAVED]: {
    product_id: string;
    product_key: string;
    location: string;
  };
  [ANALYTICS_EVENTS.PRODUCT_UNSAVED]: {
    product_id: string;
    product_key: string;
    location: string;
  };

  // Submission funnel
  [ANALYTICS_EVENTS.SUBMISSION_FORM_OPENED]: {
    source: "header_cta" | "hero_cta" | "footer_link" | "quick";
    intent: "recommend";
  };
  [ANALYTICS_EVENTS.SUBMISSION_PATH_SELECTED]: UtmProperties & {
    path: string;
    is_authenticated: boolean;
  };
  [ANALYTICS_EVENTS.SUBMISSION_FORM_STEP_COMPLETED]: { step: string };
  [ANALYTICS_EVENTS.SUBMISSION_COMPLETED]: UtmProperties & {
    category: string;
    has_logo: boolean;
    time_spent_seconds: number;
    intent: "recommend";
    guest_submission: boolean;
  };
  [ANALYTICS_EVENTS.SUBMISSION_FORM_ABANDONED]: {
    last_step_completed: string;
    time_spent_seconds: number;
  };
  [ANALYTICS_EVENTS.SUBMISSION_FORM_ERROR_SHOWN]: {
    field: string;
    error_type: string;
    step: string;
  };
  [ANALYTICS_EVENTS.NEWSLETTER_SUBSCRIBED]: UtmProperties & {
    interests: string[];
    has_email: boolean;
  };

  // Supply
  [ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED]: {
    brand_id: string;
    brand_slug: string;
    is_brand_owner: boolean;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.BRAND_REPORTED]: {
    brand_slug: string;
    reason: string;
    reporter_role: string;
  };
  [ANALYTICS_EVENTS.BRAND_CORRECTION_SUBMITTED]: {
    brand_id: string;
    brand_slug: string;
    field: string;
  };

  // Auth
  [ANALYTICS_EVENTS.USER_SIGNED_UP]: UtmProperties & { method: string };
  [ANALYTICS_EVENTS.USER_LOGGED_IN]: { method: string };
  [ANALYTICS_EVENTS.USER_SIGNED_OUT]: Record<string, never>;
  [ANALYTICS_EVENTS.USER_AUTHENTICATED]: {
    is_new_user: boolean;
  };

  // System
  [ANALYTICS_EVENTS.CTA_CLICKED]: {
    cta_name: string;
    cta_location: string;
    destination_url: string;
    page_url: string;
  };
  [ANALYTICS_EVENTS.API_ERROR_SHOWN]: {
    endpoint: string;
    status_code: number;
    user_action: string;
  };
  [ANALYTICS_EVENTS.ASSET_UPLOADED]: {
    bucket: string;
    asset_type: "image" | "document";
    size_bytes: number;
    authenticated: boolean;
    width?: number;
    height?: number;
  };
  [ANALYTICS_EVENTS.CHALLENGE_VERIFIED]: { has_custom_return_path: boolean };
  [ANALYTICS_EVENTS.RATE_LIMIT_STORE_UNAVAILABLE]: {
    error_message: string;
    cooldown_ms: number;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.RATE_LIMIT_STORE_RECOVERED]: {
    cooldown_ms: number;
    outage_ms: number;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.RATE_LIMIT_BLOCKED]: {
    route_family: string;
    ip_key: string;
    reason:
      | "hard_limit_exceeded"
      | "soft_limit_challenge"
      | "verified_budget_exhausted";
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.SCRAPE_LADDER_RECORDED]: ScrapeLadderPayload;
  [ANALYTICS_EVENTS.SCRAPE_LADDER_CHALLENGED]: ScrapeLadderPayload;
  [ANALYTICS_EVENTS.SCRAPE_LADDER_BLOCKED]: ScrapeLadderPayload;
  [ANALYTICS_EVENTS.SCRAPE_LADDER_EXTENDED_BLOCK]: ScrapeLadderPayload;
  [ANALYTICS_EVENTS.SCRAPE_LADDER_SHADOWED]: ScrapeLadderPayload;
  [ANALYTICS_EVENTS.SCRAPE_VERIFIED_BUDGET_EXHAUSTED]: ScrapeLadderPayload;
  [ANALYTICS_EVENTS.SCRAPE_IDENTITY_ROTATION_SUSPECTED]: {
    identity_key: string;
    route_family: string;
    reason: string;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.VERIFIED_CRAWLER_ALLOWED]: {
    crawler_name: string | null;
    route_family: string;
    reason: string;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.KNOWN_CRAWLER_BLOCKED]: {
    crawler_name: string;
    route_family: string;
    reason: string;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.VISITOR_IDENTITY_ROTATED]: {
    identity_key: string;
    route_family: string;
    reason: string;
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.RATE_LIMITER_DEGRADED]: {
    reason: string;
    store_kind: "in-memory" | "disabled";
    $process_person_profile: false;
  };
  [ANALYTICS_EVENTS.WEB_VITAL_REPORTED]: {
    metric_name: string;
    metric_value: number;
    metric_rating: string;
    metric_delta: number;
    metric_id: string;
    navigation_type: string | null;
    content_group: string | null;
  };
}
