const PROVIDERS = {
  serper: ["search", "images", "maps"],
  openai: ["chat_completions", "embeddings", "codex_exec"],
  resend: ["send_email"],
  upstash: ["get_database", "get_stats"],
  sentry: ["get_error_events", "list_issues"],
  // DEV-1744: `zone_egress_by_day` is the Cloudflare zone-analytics GraphQL
  // read behind image-egress anomaly monitoring. It is the only meter for
  // bytes leaving the edge, so a reading that disagrees with a billing
  // surprise has to be replayable.
  cloudflare: ["origin_probe", "zone_egress_by_day"],
  linear: ["create_ticket"],
  turnstile: ["siteverify"],
  slack: ["post_slack_alert", "post_message", "update_message", "add_reaction", "read_message_metadata"],
  posthog: ["run_query"],
  playwright: ["fetch_rendered"],
  "mit-registry": ["lookup_exact_products", "sync_registry"],
  railway: ["run_cron_now"],
  // DEV-1854: staging e2e agent claims/completes ops-bot dispatches on prod.
  "ops-dispatch": ["claim_dispatch", "complete_dispatch"],
  github: ["list_dependabot_alerts"],
  scraper: ["scrape_url"],
  catalog: ["discover_catalog"],
  http: [
    "fetch_html",
    "fetch_html_with_metadata",
    "fetch_xml",
    "fetch_text",
    "download_and_store_images",
    // Curated-product link health probe (scripts/enrichment/products/curated-products/check-links.ts):
    // a HEAD/GET reachability check whose verdict can flip a published product's
    // call-to-action, so the request and its outcome are replayable.
    "check_link",
    "check_link_weekly",
    // Curated-product image fetch: pulls the candidate image from the source
    // page it was cited from, so the bytes stored against a product can be
    // traced back to the request that produced them.
    "fetch_curated_image",
  ],
  brands: [
    "cleanupAdminBrandReviewImages",
    "cleanupDeadLinks",
    "createReport",
    "deleteBrand",
    "reviewCommunityStockist",
    "reviewCorrection",
    "saveAdminBrandReview",
    "saveBrand",
    "stageAdminBrandReviewImage",
    "submitStockist",
    "submitCorrection",
    "syncBrandImages",
    "unsaveBrand",
    "updateBrand",
    "updateProfile",
    "updateProfileAdmin",
    "updateReportStatus",
    "materializeSubmissionFaq",
    "upsertBrandFaqEntries",
    "upsertEnrichedStockists",
  ],
  cache: [
    "getCachedExploreBrandPool",
    "getCachedMetrics",
    "getCachedRecentBrandCount",
    "getCachedSubcategoryRows",
    "getCachedZhVocabularyReport",
  ],
  // Editorial write path for /brands/[slug] curated products (DEV-1465). Every
  // writer is audited: a published product is a factual claim the site makes on
  // a brand's behalf, so who moved it and when has to be replayable.
  curatedProducts: [
    "createCuratedProduct",
    "retireCuratedProduct",
    "retireCuratedProductSelection",
    "retireCuratedProductSource",
    "saveProduct",
    "unsaveProduct",
    "updateCuratedProduct",
    "upsertCuratedProductSelection",
    "upsertCuratedProductSource",
  ],
  curation: [
    "cancelCurationJob",
    "claimCurationDispatchWork",
    "claimCurationJob",
    "claimNextCurationJob",
    "dispatchCurationJob",
    "enqueueAdminCurationJob",
    "enqueueAutomaticRetry",
    "enqueueCurationRecovery",
    "enqueueScheduledSubmissionJob",
    "ensureAutomaticRetries",
    "finalizeCurationJob",
    "heartbeatCurationJob",
    "markCurationJobDispatched",
    "recordCurationDispatchFailure",
    "recoverStaleJobs",
    "reportChannelVerdicts",
    "reportCircuitBreakerTrip",
    "reportJobFailure",
    "reportProviderFailures",
    "reportWorkerFailure",
    "runJob",
    "runScheduledCuration",
    "updateCurationJobTarget",
  ],
  email: [
    "adminUnsubscribeNewsletterSubscriber",
    "confirmSubscriber",
    "createSubscriber",
    "enrollInMarketingEmails",
    "requestNewsletterSubscription",
    "resendNewsletterConfirmation",
    "setLifecycleEmailPreference",
    "unsubscribeByToken",
    "unsubscribeNewsletter",
    "unsubscribeNewsletterByEmail",
  ],
  enrich: [
    "arbitrateBrandNames",
    "arbitrateSiteIdentity",
    "classifyCategoryBatch",
    "detectBrandsBatch",
    "persistEnrichmentResults",
    "persistSubmissionEnrichmentResults",
    "rewriteBrandDescription",
    // Retired phase runners kept for historical audit rows:
    "runBrandImagePhase",
    "runClassifyImagesPhase",
    "runCleanPhase",
    "runDescriptionsPhase",
    "runDetectPhase",
    "runDiscoverPhase",
    "runEnrich",
    "runImageSearchPhase",
    // `links` was renamed to `acquire` (DEV-1644). The old runner name is kept
    // so audit rows written before the rename stay registered.
    "runLinksPhase",
    "runNamesPhase",
    "runProductsPhase",
    "runSiteIdentityPhase",
    "runStockistsPhase",
    // DEV-1644: the acquire phase wrapping the acquisition agent
    "runAcquirePhase",
  ],
  images: [
    // DEV-1551: an approved brand's images keep their `submissions/` key, which
    // the image proxy refuses to serve, so promotion server-side copies the
    // object under `brands/` and rewrites the row. Both calls are audited
    // because a copy that silently half-succeeds leaves a brand with images
    // nothing can render.
    "copySubmissionImageToPublic",
    "statStoredImageObject",
    "deleteBrandImages",
    "deleteStoredImagePaths",
    "downloadAndGateImages",
    "downloadAndStoreImages",
    "insertBrandImage",
    "loadVisionImage",
    "purgeExpiredClassifierJunk",
    "rejectBrandImages",
    "releaseBrandImageUrls",
    "storeCuratedProductImage",
    "syncHeroDenormalized",
    "uploadImageEvalAsset",
    "uploadPrivateFile",
    "uploadPublicImage",
    "uploadSubmissionImage",
  ],
  submissions: [
    "applyBrandRefresh",
    "approveSubmission",
    "cleanupSubmissionDraftImages",
    "createSubmission",
    "dropNeedsDataSubmissions",
    "executeCommunitySubmissions",
    "markFlagsReviewed",
    "rejectSubmission",
    "reopenSubmission",
    "requestBrandRefresh",
    "requestBrandRefreshesBySlugs",
    "saveModerationFlags",
    "saveSubmissionReview",
    "stageSubmissionReviewImage",
    "submitBrandForReview",
    "updateModerationFlagStatus",
  ],
  "ops-agent": [
    "createRequest",
    "admitRequest",
    "isActiveThread",
    "getRequest",
    "transitionRequest",
    "expireStale",
    "runReadonlyQuery",
    "systemStatus",
    "brandContext",
    "jobDetail",
    "executeProposal",
    "getThreadHistory",
    "completeThread",
    "reactivateThread",
    "recordDispatch",
    "clearDispatch",
    "findInFlightDispatch",
    "claimDispatch",
    "completeDispatch",
    "markDispatchStale",
  ],
  anthropic: ["fire_routine"],
  // DEV-1748: health agent migration — new audit providers for the
  // LangGraph-based health agent and its supporting services.
  "health-agent": [
    "run_detectors",
    "reconcile_lifecycle",
    "record_snapshot",
    "reportWorkerFailure",
    "probe_linear",
    "probe_github_app",
    "probe_langfuse_traces",
    "probe_langfuse_prompt",
    "probe_slack_events",
    "probe_worker_chromium",
    "probe_resend_domain",
    "probe_sentry_write",
    "probe_sentry_capture_trigger",
    "probe_sentry_capture_poll",
    "probe_surface",
    "probe_trail_supply",
  ],
  "repo-worker": ["clone", "run_tool", "push_branch", "reportWorkerFailure"],
  "github-app": ["get_installation_token"],
} as const;

type ProviderRegistry = typeof PROVIDERS;
type AuditProvider = keyof ProviderRegistry;

export function assertRegistered(provider: string, operation: string): void {
  if (!(provider in PROVIDERS)) {
    throw new Error(`Unknown audit provider: ${provider}`);
  }

  const operations = PROVIDERS[provider as AuditProvider] as readonly string[];
  if (!operations.includes(operation)) {
    throw new Error(`Unknown audit operation: ${provider}.${operation}`);
  }
}
