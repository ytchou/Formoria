/**
 * The SECOND class of intentional skip in `e2e-expected-skips.json`.
 *
 * `e2e-owner-skip-registry.ts` next door pins the skips caused by a feature
 * flag (`app_settings.owner_features_enabled`). These are caused by the
 * deployed staging ENVIRONMENT instead: the proxy refuses anonymous mutations
 * there, and the sign-in page hides its Google button and forgot-password link.
 * Both classes land in the same manifest, so both need a registry — a manifest
 * entry no registry claims is an unreviewed skip, which is the one thing this
 * gate exists to prevent.
 *
 * Unlike the owner reasons, these strings are written literally at each call
 * site rather than imported from here, because a spec that skips on an
 * environment fact reads better stating the fact than dereferencing a
 * constant. The cost is that a reworded reason would silently un-allowlist its
 * own skip, so `e2e-report-gate.test.ts` greps each named spec for the exact
 * text below rather than trusting the pairing.
 */
export const ANONYMOUS_MUTATION_REASON = 'staging blocks anonymous mutations';

export const HIDDEN_AUTH_AFFORDANCE_REASON =
  'staging hides the Google button and the forgot-password link';

/**
 * Anonymous correction mutations share the anonymous-mutation cause but not its
 * wording: `brand-corrections.spec.ts` states the fact in its own words, and the
 * matcher is a substring test, so the existing constant does not cover it.
 */
export const ANONYMOUS_CORRECTION_REASON =
  'Anonymous correction mutations are intentionally disabled on canonical staging';

/** Staging serves no sitemap on purpose, so the SEO suite skips. */
export const STAGING_NO_SITEMAP_REASON = 'Staging intentionally omits the sitemap.';

/**
 * The one DATA-conditional entry in this file, and the only one that is not a
 * permanent property of the environment: the filter needs an event lineup with
 * two or more areas, and staging's seed has fewer. Registered so the release
 * gate is not blocked by it, but it is a coverage gap to close by seeding the
 * event — not by leaving it here forever.
 */
export const EVENT_AREA_FILTER_REASON =
  'event lineup has fewer than two areas to filter by';

export type StagingConstraintSkip = {
  file: string;
  title: string;
  reason: string;
};

export const EXPECTED_STAGING_CONSTRAINT_SKIP_REGISTRY: readonly StagingConstraintSkip[] = [
  {
    file: 'newsletter-subscribe.spec.ts',
    title: 'anonymous visitor can subscribe from the homepage',
    reason: ANONYMOUS_MUTATION_REASON,
  },
  {
    file: 'submit-funnel.spec.ts',
    title: 'submits brand and reaches confirmation page',
    reason: ANONYMOUS_MUTATION_REASON,
  },
  {
    file: 'submit-recommend-edge-cases.spec.ts',
    title: 'Submit recommendation edge cases',
    reason: ANONYMOUS_MUTATION_REASON,
  },
  {
    file: 'auth-signin.spec.ts',
    title: 'sign-in page renders the heading and Google entry point',
    reason: HIDDEN_AUTH_AFFORDANCE_REASON,
  },
  {
    file: 'auth-password-reset.spec.ts',
    title: 'sign-in page links to the forgot-password form',
    reason: HIDDEN_AUTH_AFFORDANCE_REASON,
  },
  {
    file: 'brand-corrections.spec.ts',
    title: 'Brand corrections — anonymous crowd QA',
    reason: ANONYMOUS_CORRECTION_REASON,
  },
  {
    file: 'seo.spec.ts',
    title: 'sitemap',
    reason: STAGING_NO_SITEMAP_REASON,
  },
  {
    file: 'event-detail.spec.ts',
    title: 'area chips filter the brand grid in place',
    reason: EVENT_AREA_FILTER_REASON,
  },
] as const;
