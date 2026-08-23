const PROVIDERS = {
  serper: ["search", "images", "maps"],
  openai: ["chat_completions"],
  deepseek: ["chat_completions", "balance"],
  resend: ["send_email"],
  upstash: ["get_database", "get_stats"],
  sentry: ["get_error_events"],
  cloudflare: ["origin_probe"],
  turnstile: ["siteverify"],
  slack: ["post_slack_alert"],
  posthog: ["run_query"],
  "mit-registry": [
    "lookup_cert_number",
    "lookup_cert_numbers",
    "sync_registry",
  ],
  playwright: ["fetch_rendered"],
  scraper: ["scrape_url"],
  http: [
    "fetch_html",
    "fetch_html_with_metadata",
    "fetch_xml",
    "download_and_store_images",
    // Curated-product link health probe (scripts/curated-products/check-links.ts):
    // a HEAD/GET reachability check whose verdict can flip a published product's
    // call-to-action, so the request and its outcome are replayable.
    "check_link",
    // Curated-product image fetch: pulls the candidate image from the source
    // page it was cited from, so the bytes stored against a product can be
    // traced back to the request that produced them.
    "fetch_curated_image",
  ],
  brands: [
    "cleanupAdminBrandReviewImages",
    "cleanupDeadLinks",
    "createEvidence",
    "createReport",
    "declareMit",
    "deleteBrand",
    "reviewCommunityStockist",
    "reviewCorrection",
    "reviewEvidence",
    "saveAdminBrandReview",
    "saveBrand",
    "stageAdminBrandReviewImage",
    "stripDeclaration",
    "submitStockist",
    "submitCorrection",
    "syncBrandImages",
    "unsaveBrand",
    "updateBrand",
    "updateProfile",
    "updateProfileAdmin",
    "updateReportStatus",
    "upsertBrandFaqEntries",
    "upsertEnrichedStockists",
    "withdrawDeclaration",
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
    "enqueueCurationResume",
    "enqueueManualRerun",
    "enqueueScheduledSubmissionJob",
    "ensureAutomaticRetries",
    "finalizeCurationJob",
    "heartbeatCurationJob",
    "markCurationJobDispatched",
    "recordCurationDispatchFailure",
    "recoverStaleJobs",
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
    "createEmailPreferences",
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
    "runBrandImagePhase",
    "runClassifyImagesPhase",
    "runCleanPhase",
    "runDescriptionsPhase",
    "runDetectPhase",
    "runDiscoverPhase",
    "runEnrich",
    "runImageSearchPhase",
    "runLinksPhase",
    "runNamesPhase",
    "runProductsPhase",
    "runReputationPhase",
    "runReputationResearch",
    "runSiteIdentityPhase",
    "runStandaloneClassification",
  ],
  images: [
    // DEV-1551: an approved brand's images keep their `submissions/` key, which
    // the image proxy refuses to serve, so promotion server-side copies the
    // object under `brands/` and rewrites the row. Both calls are audited
    // because a copy that silently half-succeeds leaves a brand with images
    // nothing can render.
    "copyBrandImageObject",
    "statBrandImageObject",
    "deleteBrandImages",
    "deleteStoredImagePaths",
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
    "uploadPrivateImage",
    "uploadPublicImage",
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
