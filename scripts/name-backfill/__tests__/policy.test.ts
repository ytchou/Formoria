import { describe, expect, it } from "vitest";
import {
  evaluateNameBackfillEligibility,
  isIdentityBackfillJobForSubmission,
  isResumableNameBackfillWrite,
  parseNameBackfillMode,
  type NameBackfillBrand,
} from "../policy";

const snapshot: NameBackfillBrand = {
  id: "28d74db4-655f-47bf-a0ac-a667bc1daa26",
  slug: "lid-shoes",
  name: "LID Shoes",
  status: "approved",
  purchase_website: "https://www.lidshoes.com/about/",
};

const proposal = {
  value: "劉一刀手工鞋 LID Shoes",
  confidence: "high" as const,
  reason: "官網直接使用雙語品牌名",
  evidence: [
    {
      source: "official_website" as const,
      url: "https://www.lidshoes.com/about",
      observedName: "劉一刀 手工鞋",
    },
  ],
};

describe("one-time name backfill eligibility", () => {
  it("accepts the exact LID Shoes name-only backfill", () => {
    expect(
      evaluateNameBackfillEligibility({
        current: snapshot,
        snapshot,
        proposal,
      }),
    ).toEqual({ eligible: true, proposal });
  });

  it("rejects drift in approval, current name, or slug", () => {
    expect(
      evaluateNameBackfillEligibility({
        current: { ...snapshot, status: "hidden" },
        snapshot,
        proposal,
      }),
    ).toMatchObject({ eligible: false });
    expect(
      evaluateNameBackfillEligibility({
        current: { ...snapshot, name: "LID" },
        snapshot,
        proposal,
      }),
    ).toMatchObject({ eligible: false });
    expect(
      evaluateNameBackfillEligibility({
        current: { ...snapshot, slug: "lid-shoes-new" },
        snapshot,
        proposal,
      }),
    ).toMatchObject({ eligible: false });
  });

  it("rejects English-first, low-confidence, and invented proposals", () => {
    for (const invalid of [
      { ...proposal, value: "LID Shoes 劉一刀手工鞋" },
      { ...proposal, confidence: "medium" },
      { ...proposal, value: "劉一刀鞋坊 LID Shoes" },
    ]) {
      expect(
        evaluateNameBackfillEligibility({
          current: snapshot,
          snapshot,
          proposal: invalid,
        }),
      ).toMatchObject({ eligible: false });
    }
  });

  it("rejects evidence from a discovered retailer or mismatched source type", () => {
    expect(
      evaluateNameBackfillEligibility({
        current: snapshot,
        snapshot,
        proposal: {
          ...proposal,
          evidence: [
            {
              source: "official_website",
              url: "https://retailer.example/lid-shoes",
              observedName: "劉一刀手工鞋 LID Shoes",
            },
          ],
        },
      }),
    ).toMatchObject({ eligible: false });
    expect(
      evaluateNameBackfillEligibility({
        current: snapshot,
        snapshot,
        proposal: {
          ...proposal,
          evidence: [
            {
              source: "official_social",
              url: snapshot.purchase_website,
              observedName: "劉一刀手工鞋 LID Shoes",
            },
          ],
        },
      }),
    ).toMatchObject({ eligible: false });
  });

  it("rejects evidence for an official URL removed after the refresh snapshot", () => {
    expect(
      evaluateNameBackfillEligibility({
        current: { ...snapshot, purchase_website: null },
        snapshot,
        proposal,
      }),
    ).toMatchObject({ eligible: false });
  });
});

describe("one-time name backfill command safety", () => {
  it("requires exactly one explicit safety mode", () => {
    expect(parseNameBackfillMode(["--dry-run"])).toBe("dry-run");
    expect(parseNameBackfillMode(["--confirm"])).toBe("confirm");
    expect(() => parseNameBackfillMode([])).toThrow(
      "Pass exactly one of --dry-run or --confirm",
    );
    expect(() => parseNameBackfillMode(["--dry-run", "--confirm"])).toThrow(
      "Pass exactly one of --dry-run or --confirm",
    );
  });
});

describe("one-time name backfill recovery", () => {
  it("recognizes only the exact audited write from the refresh job", () => {
    const current = { ...snapshot, name: proposal.value };
    const event = {
      brand_id: snapshot.id,
      field: "name",
      source: "admin",
      job_id: "25f2550f-f2e4-40e1-a572-d5b79b10ae8d",
      old_value: snapshot.name,
      new_value: proposal.value,
    };
    expect(
      isResumableNameBackfillWrite({
        current,
        snapshot,
        proposal,
        event,
        jobId: event.job_id,
      }),
    ).toBe(true);
    expect(
      isResumableNameBackfillWrite({
        current,
        snapshot,
        proposal,
        event: { ...event, source: "owner" },
        jobId: event.job_id,
      }),
    ).toBe(false);
  });
});

describe("one-time identity job isolation", () => {
  const submissionId = "9fc48ffc-bf56-498f-8937-0541407dc536";
  const job = {
    id: "25f2550f-f2e4-40e1-a572-d5b79b10ae8d",
    status: "completed",
    operation: "enrich",
    dry_run: false,
    params: {
      target: "submissions",
      task: "identity",
      submissionIds: [submissionId],
    },
  };

  it("accepts only the completed identity job that names the refresh", () => {
    expect(isIdentityBackfillJobForSubmission(job, submissionId)).toBe(true);
    expect(
      isIdentityBackfillJobForSubmission(
        { ...job, params: { ...job.params, task: "full" } },
        submissionId,
      ),
    ).toBe(false);
    expect(
      isIdentityBackfillJobForSubmission(job, "6d57fecc-d7ba-4dc4-af6b-aeed355b2f61"),
    ).toBe(false);
  });
});
