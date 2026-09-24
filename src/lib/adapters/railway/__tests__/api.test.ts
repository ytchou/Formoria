import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { runE2eAgentNow } from "../api";

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const ENVIRONMENT_ID = "cb8f8b37-b99f-4c88-9f83-e5d969d3cfd4";
const INSTANCE_ID = "si-e2e-nightly-agent";

let writes: AuditRecord[] = [];

function lookupResponse(
  nodes: Array<{ id: string; serviceName: string }> = [
    { id: "si-decoy", serviceName: "Formoria Staging" },
    { id: INSTANCE_ID, serviceName: "e2e-nightly-agent" },
  ],
): Response {
  return Response.json({
    data: {
      environment: {
        serviceInstances: { edges: nodes.map((node) => ({ node })) },
      },
    },
  });
}

function bodyOf(init: RequestInit | undefined) {
  return JSON.parse(init!.body as string) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("OPS_AGENT_RAILWAY_TOKEN", "rw_test_token");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runE2eAgentNow", () => {
  it("runE2eAgentNow_resolves_instance_by_name_then_runs_it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(lookupResponse())
      .mockResolvedValueOnce(
        Response.json({ data: { deploymentInstanceExecutionCreate: true } }),
      );

    const result = await runE2eAgentNow();

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(GRAPHQL_URL);
      expect(init!.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer rw_test_token" }),
      );
    }

    const lookup = bodyOf(fetchMock.mock.calls[0]![1]);
    expect(lookup.query).toContain("serviceInstances");
    expect(lookup.variables.id).toBe(ENVIRONMENT_ID);

    const mutation = bodyOf(fetchMock.mock.calls[1]![1]);
    expect(mutation.query).toContain("deploymentInstanceExecutionCreate");
    expect(mutation.variables.input).toEqual({ serviceInstanceId: INSTANCE_ID });

    const terminal = writes.filter((w) => w.status !== "started");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toEqual(
      expect.objectContaining({
        provider: "railway",
        operation: "run_cron_now",
        status: "succeeded",
        summary: expect.objectContaining({ serviceInstanceId: INSTANCE_ID }),
      }),
    );
  });

  it("runE2eAgentNow_returns_error_when_service_not_found", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        lookupResponse([{ id: "si-decoy", serviceName: "Formoria Staging" }]),
      );

    const result = await runE2eAgentNow();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("e2e-nightly-agent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runE2eAgentNow_returns_error_on_lookup_http_failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

    const result = await runE2eAgentNow();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("500");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writes.filter((w) => w.status !== "started")).toEqual([
      expect.objectContaining({ operation: "run_cron_now", status: "failed" }),
    ]);
  });

  it("runE2eAgentNow_returns_graphql_error_from_lookup", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ errors: [{ message: "Not Authorized" }] }),
      );

    const result = await runE2eAgentNow();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("Not Authorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runE2eAgentNow_returns_graphql_error_from_mutation", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(lookupResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [{ message: "failed to invoke cron execution" }],
        }),
      );

    const result = await runE2eAgentNow();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(
      "failed to invoke cron execution",
    );
  });

  it("runE2eAgentNow_returns_error_when_mutation_returns_false", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(lookupResponse())
      .mockResolvedValueOnce(
        Response.json({ data: { deploymentInstanceExecutionCreate: false } }),
      );

    const result = await runE2eAgentNow();

    expect(result.ok).toBe(false);
  });

  it("runE2eAgentNow_throws_when_token_missing", async () => {
    vi.stubEnv("OPS_AGENT_RAILWAY_TOKEN", "");
    // Vitest stubEnv with empty string — clear it properly
    delete process.env.OPS_AGENT_RAILWAY_TOKEN;

    await expect(runE2eAgentNow()).rejects.toThrow(
      "OPS_AGENT_RAILWAY_TOKEN is not set",
    );
  });
});
