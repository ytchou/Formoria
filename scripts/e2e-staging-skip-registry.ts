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
    file: 'feature-requests.spec.ts',
    title: 'signed-out visitor upvotes without signing in',
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
] as const;
