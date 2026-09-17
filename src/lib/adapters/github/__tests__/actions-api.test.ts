import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import {
  dispatchWorkflow,
  listWorkflowRuns,
  WORKFLOW_ALLOWLIST,
} from "../actions-api";

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("OPS_AGENT_GITHUB_TOKEN", "ghp_test_token");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("listWorkflowRuns", () => {
  it("list_workflow_runs_maps_fields", async () => {
    const apiResponse = {
      workflow_runs: [
        {
          id: 123,
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/ytchou/Formoria/actions/runs/123",
          created_at: "2026-09-15T10:00:00Z",
          head_branch: "staging",
          extra_field: "ignored",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(apiResponse));

    const runs = await listWorkflowRuns("e2e-staging.yml");

    expect(runs).toEqual([
      {
        id: 123,
        status: "completed",
        conclusion: "success",
        htmlUrl: "https://github.com/ytchou/Formoria/actions/runs/123",
        createdAt: "2026-09-15T10:00:00Z",
        headBranch: "staging",
      },
    ]);

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/actions/workflows/e2e-staging.yml/runs");
  });
});

describe("dispatchWorkflow", () => {
  it("dispatch_workflow_posts_ref_and_inputs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await dispatchWorkflow("e2e-staging.yml", {
      branch: "feat/test",
    });

    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/actions/workflows/e2e-staging.yml/dispatches");
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({ ref: "staging", inputs: { branch: "feat/test" } });
  });

  it("dispatch_rejects_unknown_workflow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      dispatchWorkflow("malicious.yml"),
    ).rejects.toThrow(/not in allowlist/);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(WORKFLOW_ALLOWLIST).not.toContain("malicious.yml");
  });

  it("allowlist does not contain health-agent.yml", () => {
    expect(WORKFLOW_ALLOWLIST).not.toContain("health-agent.yml");
  });

  it("github_error_returned_not_thrown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
      }),
    );

    const result = await dispatchWorkflow("e2e-staging.yml");
    expect(result).toEqual({ ok: false, status: 401 });
  });
});
