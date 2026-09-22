import { describe, expect, it } from "vitest";
import type { RepairFinding, RepairRequest } from "@/lib/services/health-agent/repair-request";
import {
  extractRepairRequest,
} from "../repair";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validFinding: RepairFinding = {
  fingerprint: "abc123",
  title: "Missing hero image for brand foo-bar",
  severity: "warning",
  source: "image-audit",
  ticketId: "DEV-9999",
};

const validRequest: RepairRequest = {
  agent: "health-agent",
  ref: "staging",
  runId: "run-001",
  traceUrl: "https://langfuse.example.com/trace/run-001",
  scope: ["src/lib/services/brands/images.ts", "src/lib/services/brands/hero.ts"],
  findings: [validFinding],
};

function wrapJson(obj: unknown): string {
  return "Some preceding text\n```json\n" + JSON.stringify(obj) + "\n```\nTrailing text";
}

// ---------------------------------------------------------------------------
// extractRepairRequest
// ---------------------------------------------------------------------------

describe("extractRepairRequest", () => {
  it("extractRepairRequest_valid_json_block", () => {
    const result = extractRepairRequest(wrapJson(validRequest));
    expect(result).not.toBeNull();
    expect(result!.agent).toBe("health-agent");
    expect(result!.runId).toBe("run-001");
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].fingerprint).toBe("abc123");
    expect(result!.scope).toEqual([
      "src/lib/services/brands/images.ts",
      "src/lib/services/brands/hero.ts",
    ]);
  });

  it("extractRepairRequest_no_json_block", () => {
    const result = extractRepairRequest("Just plain text with no code block");
    expect(result).toBeNull();
  });

  it("extractRepairRequest_malformed_json", () => {
    const result = extractRepairRequest("```json\n{ broken ]\n```");
    expect(result).toBeNull();
  });

  it("extractRepairRequest_wrong_schema", () => {
    const result = extractRepairRequest(
      wrapJson({ name: "not a repair request", count: 42 }),
    );
    expect(result).toBeNull();
  });

  it("extractRepairRequest_empty_findings", () => {
    const result = extractRepairRequest(
      wrapJson({ ...validRequest, findings: [] }),
    );
    expect(result).toBeNull();
  });

  it("extractRepairRequest_accepts_findings_with_rootCause_and_permalink", () => {
    const findingWithExtras: RepairFinding = {
      ...validFinding,
      rootCause: "Null pointer in hero selection",
      permalink: "https://sentry.io/issues/99999/",
    };
    const request: RepairRequest = {
      ...validRequest,
      findings: [findingWithExtras],
    };
    const result = extractRepairRequest(wrapJson(request));
    expect(result).not.toBeNull();
    expect(result!.findings[0].rootCause).toBe("Null pointer in hero selection");
    expect(result!.findings[0].permalink).toBe("https://sentry.io/issues/99999/");
  });

  it("extractRepairRequest_evidence_round_trips", () => {
    const findingWithEvidence: RepairFinding = {
      ...validFinding,
      evidence: {
        count: 42,
        userCount: 7,
        lastSeen: "2026-09-22T07:00:00Z",
        sampleIds: ["abc", "def"],
      },
    };
    const request: RepairRequest = {
      ...validRequest,
      findings: [findingWithEvidence],
    };
    const result = extractRepairRequest(wrapJson(request));
    expect(result).not.toBeNull();
    expect(result!.findings[0].evidence).toEqual({
      count: 42,
      userCount: 7,
      lastSeen: "2026-09-22T07:00:00Z",
      sampleIds: ["abc", "def"],
    });
  });
});

