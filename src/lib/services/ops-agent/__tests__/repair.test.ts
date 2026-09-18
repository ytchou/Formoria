import { describe, expect, it, vi } from "vitest";
import type { RepairFinding, RepairRequest } from "@/lib/services/health-agent/repair-request";
import {
  extractRepairRequest,
  mapFindingToInstruction,
  executeRepairRequest,
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
});

// ---------------------------------------------------------------------------
// mapFindingToInstruction
// ---------------------------------------------------------------------------

describe("mapFindingToInstruction", () => {
  it("mapFindingToCodeFixInstruction_includes_title_and_scope", () => {
    const instruction = mapFindingToInstruction(
      validFinding,
      "run-001",
      ["src/a.ts", "src/b.ts"],
    );
    expect(instruction).toContain(validFinding.title);
    expect(instruction).toContain("src/a.ts");
    expect(instruction).toContain("src/b.ts");
  });

  it("mapFindingToCodeFixInstruction_within_length_limits", () => {
    const instruction = mapFindingToInstruction(
      validFinding,
      "run-001",
      ["src/a.ts"],
    );
    expect(instruction.length).toBeGreaterThanOrEqual(10);
    expect(instruction.length).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// executeRepairRequest
// ---------------------------------------------------------------------------

describe("executeRepairRequest", () => {
  const ctx = {
    requestId: "req-001",
    channelId: "C123",
    threadTs: "1234567890.123456",
  };

  it("executeRepairRequest_success", async () => {
    const dispatchWorkflow = vi.fn().mockResolvedValue({ ok: true });
    const result = await executeRepairRequest(
      validRequest,
      { dispatchWorkflow },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].ok).toBe(true);
    expect(dispatchWorkflow).toHaveBeenCalledWith("ops-fix.yml", {
      instruction: expect.stringContaining(validFinding.title),
      request_id: "req-001",
      channel: "C123",
      thread_ts: "1234567890.123456",
    });
  });

  it("executeRepairRequest_dispatch_rejection", async () => {
    const dispatchWorkflow = vi
      .fn()
      .mockRejectedValue(new Error("Workflow not in allowlist"));
    const result = await executeRepairRequest(
      validRequest,
      { dispatchWorkflow },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].error).toContain("allowlist");
  });

  it("executeRepairRequest_dispatch_http_failure", async () => {
    const dispatchWorkflow = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403 });
    const result = await executeRepairRequest(
      validRequest,
      { dispatchWorkflow },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].error).toContain("403");
  });
});
