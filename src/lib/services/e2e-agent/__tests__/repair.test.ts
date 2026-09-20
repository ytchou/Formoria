import { describe, expect, it, vi } from "vitest";
import { repairFailures, type RepairDeps } from "../repair";
import { freezeFailures } from "@/lib/services/e2e-selfheal/incident";
import type { RepoWorkerClient } from "@/lib/services/health-agent/repo-worker-client";
import type { DiagnosisResult } from "@/lib/services/e2e-selfheal/incident";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const frozen = freezeFailures([
  {
    file: "e2e/tests/search.spec.ts",
    project: "deep",
    title: "search works",
  },
]);

const diagnosis: DiagnosisResult = {
  version: 1,
  failureSetHash: frozen.failureSetHash,
  failures: frozen.failures.map((f) => ({
    ...f,
    category: "test-drift" as const,
    rootCauseKey: "search-copy",
    actionable: true,
    reason: "The public label changed.",
  })),
  clusters: [
    {
      rootCauseKey: "search-copy",
      failureIds: frozen.failures.map(({ id }) => id),
      category: "test-drift",
      actionable: true,
      plannedFiles: ["e2e/tests/search.spec.ts"],
      diagnosis: "Both projects assert the old label.",
      repairPlan: "Update both assertions.",
    },
  ],
  complete: true,
};

function buildDeps(
  clientOverrides: Partial<RepoWorkerClient> = {},
  extraDeps: Partial<RepairDeps> = {},
): { deps: RepairDeps; createClient: ReturnType<typeof vi.fn> } {
  const mockClient: RepoWorkerClient = {
    run: vi.fn().mockResolvedValue({
      status: "done" as const,
      changedFiles: [
        { path: "e2e/tests/search.spec.ts", content: "updated content" },
      ],
      baseSha: "def456",
      agent: {
        structuredOutput: {
          version: 1,
          failureSetHash: frozen.failureSetHash,
          addressedFailureIds: frozen.failures.map(({ id }) => id),
          addressedRootCauseKeys: ["search-copy"],
          changedFiles: ["e2e/tests/search.spec.ts"],
          summary: "Updated search assertion.",
          remainingWork: [],
          complete: true,
        },
        sessionId: "sess-3",
        usage: { input_tokens: 200, output_tokens: 40 },
      },
    }),
    ...clientOverrides,
  };

  const createClient = vi.fn().mockReturnValue(mockClient);

  return {
    createClient,
    deps: {
      createClient,
      failures: frozen,
      diagnosis,
      fetchPrompt: vi.fn().mockResolvedValue("You are a repair agent."),
      stagingSha: "abc123",
      ...extraDeps,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("repair_dispatches_with_scoped_editable_files", () => {
  it("includes e2e and src glob patterns in editableFiles", async () => {
    const { deps, createClient } = buildDeps();

    await repairFailures(deps);

    const client = createClient.mock.results[0].value as RepoWorkerClient;
    const runFn = client.run as ReturnType<typeof vi.fn>;
    expect(runFn).toHaveBeenCalledOnce();

    const request = runFn.mock.calls[0][0];
    expect(request.editableFiles).toContain("e2e/**/*.ts");
    expect(request.editableFiles).toContain("src/**/*.ts");
    expect(request.editableFiles).toContain("src/**/*.tsx");
    expect(request.agent.access).toBe("write");
  });
});

describe("repair_uses_1200s_deadline", () => {
  it("passes deadlineMs 1_200_000 to createClient", async () => {
    const { deps, createClient } = buildDeps();

    await repairFailures(deps);

    expect(createClient).toHaveBeenCalledWith(1_200_000);
  });
});

describe("repair_returns_needs_human_when_no_changes", () => {
  it("returns needs_human outcome when changedFiles is empty", async () => {
    const mockClient: RepoWorkerClient = {
      run: vi.fn().mockResolvedValue({
        status: "done" as const,
        changedFiles: [],
        baseSha: "def456",
        agent: {
          structuredOutput: null,
          sessionId: "sess-4",
        },
      }),
    };

    const { deps } = buildDeps({ run: mockClient.run });

    const result = await repairFailures(deps);

    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("needs_human");
  });

  it("returns needs_human when changedFiles is undefined", async () => {
    const mockClient: RepoWorkerClient = {
      run: vi.fn().mockResolvedValue({
        status: "done" as const,
        baseSha: "def456",
        agent: {
          structuredOutput: null,
          sessionId: "sess-5",
        },
      }),
    };

    const { deps } = buildDeps({ run: mockClient.run });

    const result = await repairFailures(deps);

    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("needs_human");
  });
});
