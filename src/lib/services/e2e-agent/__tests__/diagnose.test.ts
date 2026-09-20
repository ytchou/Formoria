import { describe, expect, it, vi } from "vitest";
import { diagnoseFailures, type DiagnoseDeps } from "../diagnose";
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
  {
    file: "e2e/tests/mobile.spec.ts",
    project: "mobile",
    title: "mobile nav opens",
  },
]);

function makeDiagnosisOutput(
  overrides: Partial<DiagnosisResult> = {},
): DiagnosisResult {
  return {
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
        plannedFiles: ["e2e/tests/search.spec.ts", "e2e/tests/mobile.spec.ts"],
        diagnosis: "Both projects assert the old label.",
        repairPlan: "Update both assertions.",
      },
    ],
    complete: true,
    ...overrides,
  };
}

function makeEnvDiagnosisOutput(): DiagnosisResult {
  return {
    version: 1,
    failureSetHash: frozen.failureSetHash,
    failures: frozen.failures.map((f) => ({
      ...f,
      category: "env-flake" as const,
      rootCauseKey: "supabase-timeout",
      actionable: false,
      reason: "Supabase connection timed out.",
    })),
    clusters: [
      {
        rootCauseKey: "supabase-timeout",
        failureIds: frozen.failures.map(({ id }) => id),
        category: "env-flake",
        actionable: false,
        plannedFiles: [],
        diagnosis: "Supabase was down during the run.",
        repairPlan: "Retry the run.",
      },
    ],
    complete: true,
  };
}

function buildDeps(
  clientOverrides: Partial<RepoWorkerClient> = {},
  extraDeps: Partial<DiagnoseDeps> = {},
): { deps: DiagnoseDeps; createClient: ReturnType<typeof vi.fn> } {
  const mockClient: RepoWorkerClient = {
    run: vi.fn().mockResolvedValue({
      status: "done" as const,
      agent: {
        structuredOutput: makeDiagnosisOutput(),
        sessionId: "sess-1",
        usage: { input_tokens: 100, output_tokens: 20 },
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
      fetchPrompt: vi.fn().mockResolvedValue("You are a diagnosis agent."),
      stagingSha: "abc123",
      ...extraDeps,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("diagnose_dispatches_to_repo_worker_with_read_only_access", () => {
  it("sends empty editableFiles and read-only agent access", async () => {
    const { deps, createClient } = buildDeps();

    await diagnoseFailures(deps);

    const client = createClient.mock.results[0].value as RepoWorkerClient;
    const runFn = client.run as ReturnType<typeof vi.fn>;
    expect(runFn).toHaveBeenCalledOnce();

    const request = runFn.mock.calls[0][0];
    expect(request.editableFiles).toEqual([]);
    expect(request.agent.access).toBe("read");
    expect(request.agent.jsonSchema).toMatchObject({ type: "object" });
  });
});

describe("diagnose_classifies_noise_when_all_failures_are_environment", () => {
  it("returns aggregate noise when all failures are env-flake", async () => {
    const envOutput = makeEnvDiagnosisOutput();
    const mockClient: RepoWorkerClient = {
      run: vi.fn().mockResolvedValue({
        status: "done" as const,
        agent: {
          structuredOutput: envOutput,
          sessionId: "sess-2",
          usage: { input_tokens: 80, output_tokens: 16 },
        },
      }),
    };
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await diagnoseFailures({
      createClient,
      failures: frozen,
      fetchPrompt: vi.fn().mockResolvedValue("You are a diagnosis agent."),
      stagingSha: "abc123",
    });

    expect(result).not.toBeNull();
    expect(result!.aggregate).toBe("noise");
  });
});

describe("diagnose_uses_900s_deadline", () => {
  it("keeps polling beyond the worker's install and Codex timeouts", async () => {
    const { deps, createClient } = buildDeps();

    await diagnoseFailures(deps);

    expect(createClient).toHaveBeenCalledWith(1_500_000);
  });
});
