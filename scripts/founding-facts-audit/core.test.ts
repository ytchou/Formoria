import { describe, expect, it } from "vitest";
import {
  buildDecisionApplyPlan,
  validateDecisionBundle,
  type FoundingFactsAuditArtifact,
  type FoundingFactsDecisionBundle,
} from "./core";

const artifact: FoundingFactsAuditArtifact = {
  version: 1,
  runId: "run-2026-08-31",
  createdAt: "2026-08-31T00:00:00.000Z",
  mode: "pilot",
  metrics: {
    approvedCount: 20,
    cityPopulatedBefore: 10,
    foundingYearPopulatedBefore: 10,
    seoPromotedBefore: 8,
    searchFailures: 0,
    fetchFailures: 0,
    serperCredits: 20,
    llmCalls: 40,
    llmCostUsd: null,
    llmUnpricedCalls: 40,
  },
  brands: [
    {
      snapshot: {
        id: "brand-1",
        name: "Harbor Form",
        slug: "harbor-form",
        status: "approved",
        city: "tainan",
        foundingYear: null,
        seoPromoted: false,
      },
      sources: [],
      fields: {
        city: {
          field: "city",
          expectedCurrent: "tainan",
          protection: null,
          proposal: {
            field: "city",
            value: "taipei",
            confidence: "medium",
            evidence: [],
            conflicts: [],
            rejections: [],
            evidenceHash: "city-hash",
          },
          action: "review",
          requiresDecision: true,
          humanOriginConflict: false,
        },
        founding_year: {
          field: "founding_year",
          expectedCurrent: null,
          protection: null,
          proposal: {
            field: "founding_year",
            value: 2019,
            confidence: "high",
            evidence: [],
            conflicts: [],
            rejections: [],
            evidenceHash: "year-hash",
          },
          action: "fill",
          requiresDecision: false,
          humanOriginConflict: false,
        },
      },
    },
  ],
};

const decisions: FoundingFactsDecisionBundle = {
  version: 1,
  runId: artifact.runId,
  exportedAt: "2026-08-31T01:00:00.000Z",
  decisions: [
    {
      brandId: "brand-1",
      field: "city",
      decision: "accept-proposal",
      expectedCurrent: "tainan",
      evidenceHash: "city-hash",
    },
  ],
};

describe("founding-fact decision validation", () => {
  it("round-trips a complete run-bound decision bundle", () => {
    expect(validateDecisionBundle(artifact, decisions)).toEqual([]);
    expect(buildDecisionApplyPlan(artifact, decisions)).toEqual([
      {
        brandId: "brand-1",
        field: "city",
        expectedCurrent: "tainan",
        value: "taipei",
        evidenceHash: "city-hash",
        decision: "accept-proposal",
      },
    ]);
  });

  it("rejects a stale run, snapshot, or evidence hash", () => {
    expect(
      validateDecisionBundle(artifact, { ...decisions, runId: "other-run" }),
    ).toContain("decision run ID does not match the audit artifact");
    expect(
      validateDecisionBundle(artifact, {
        ...decisions,
        decisions: [
          { ...decisions.decisions[0]!, expectedCurrent: "kaohsiung" },
        ],
      }),
    ).toContain("brand-1.city expected current value does not match");
    expect(
      validateDecisionBundle(artifact, {
        ...decisions,
        decisions: [{ ...decisions.decisions[0]!, evidenceHash: "stale-hash" }],
      }),
    ).toContain("brand-1.city evidence hash does not match");
  });

  it("requires a decision for every review field", () => {
    expect(
      validateDecisionBundle(artifact, { ...decisions, decisions: [] }),
    ).toContain("brand-1.city is missing a review decision");
  });

  it("retains without a write and clears only through an explicit set-null decision", () => {
    expect(
      buildDecisionApplyPlan(artifact, {
        ...decisions,
        decisions: [{ ...decisions.decisions[0]!, decision: "retain-current" }],
      }),
    ).toEqual([]);
    expect(
      buildDecisionApplyPlan(artifact, {
        ...decisions,
        decisions: [{ ...decisions.decisions[0]!, decision: "set-null" }],
      }),
    ).toEqual([expect.objectContaining({ value: null, decision: "set-null" })]);
  });
});
