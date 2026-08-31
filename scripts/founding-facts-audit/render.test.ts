import { describe, expect, it } from "vitest";
import { renderAuditHtml } from "./render";
import type { FoundingFactsAuditArtifact } from "./core";

describe("renderAuditHtml", () => {
  it("renders escaped evidence and run-bound decision export controls", () => {
    const artifact: FoundingFactsAuditArtifact = {
      version: 1,
      runId: "run-123",
      createdAt: "2026-08-31T00:00:00.000Z",
      mode: "pilot",
      metrics: {
        approvedCount: 1,
        cityPopulatedBefore: 1,
        foundingYearPopulatedBefore: 0,
        seoPromotedBefore: 0,
        searchFailures: 0,
        fetchFailures: 0,
        serperCredits: 1,
        llmCalls: 2,
        llmCostUsd: 0.01,
        llmUnpricedCalls: 0,
      },
      brands: [
        {
          snapshot: {
            id: "brand-1",
            name: "Harbor <Form>",
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
                value: null,
                confidence: "none",
                evidence: [],
                conflicts: [],
                rejections: [],
                evidenceHash: "year-hash",
              },
              action: "unresolved",
              requiresDecision: false,
              humanOriginConflict: false,
            },
          },
        },
      ],
    };

    const html = renderAuditHtml(artifact);

    expect(html).toContain("Harbor &lt;Form&gt;");
    expect(html).not.toContain("Harbor <Form>");
    expect(html).toContain("accept-proposal");
    expect(html).toContain("retain-current");
    expect(html).toContain("set-null");
    expect(html).toContain("run-123");
    expect(html).toContain("localStorage");
    expect(html).toContain("city-hash");
  });
});
