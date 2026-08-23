export type OwnerFeatureCallsite = {
  file: string;
  title: string;
  reason: "off" | "on";
  kind: "skip" | "assertion";
};

/**
 * The source registry for deterministic owner-feature skips. The assertion
 * entry is intentionally not part of the report manifest: static-pages tests
 * assert both flag states rather than skipping either state.
 */
export const OWNER_FEATURE_CALLSITES: readonly OwnerFeatureCallsite[] = [
  {
    file: "admin-moderation.spec.ts",
    title: "Content moderation flow",
    reason: "off",
    kind: "skip",
  },
  {
    file: "auth-signup-journey.spec.ts",
    title: "Auth — signup to first value",
    reason: "off",
    kind: "skip",
  },
  {
    file: "claim-lifecycle.spec.ts",
    title: "Claim request lifecycle",
    reason: "off",
    kind: "skip",
  },
  {
    file: "claim-smoke.spec.ts",
    title: "Claim request smoke",
    reason: "off",
    kind: "skip",
  },
  {
    file: "community-submit.spec.ts",
    title: "Community submit flow › @smoke owner quick form shows its core fields when owner features are enabled",
    reason: "off",
    kind: "skip",
  },
  {
    file: "owner-features-flag-off.spec.ts",
    title: "Owner features gated off",
    reason: "on",
    kind: "skip",
  },
  {
    file: "static-pages.spec.ts",
    title: "static pages owner-feature assertion",
    reason: "off",
    kind: "assertion",
  },
  {
    file: "submit-funnel.spec.ts",
    title: "Submit funnel › detailed owner wizard writes only on final submit and preserves shared links",
    reason: "off",
    kind: "skip",
  },
] as const;

export const EXPECTED_OWNER_FEATURE_SKIP_REGISTRY = OWNER_FEATURE_CALLSITES.filter(
  (entry) => entry.kind === "skip",
);
