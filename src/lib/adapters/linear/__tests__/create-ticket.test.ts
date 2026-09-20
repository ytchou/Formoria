import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { createTicket } from "../create-ticket";

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("LINEAR_API_KEY", "lin_api_test_key");
  vi.stubEnv("LINEAR_TEAM_ID", "team_test_id");
  vi.stubEnv("LINEAR_LABEL_DATA_QUALITY", "uuid-data-quality");
  vi.stubEnv("LINEAR_LABEL_OPS", "uuid-ops");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createTicket", () => {
  it("creates ticket with valid spec", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: {
          issueCreate: { issue: { identifier: "DEV-9999" } },
        },
      }),
    );

    const result = await createTicket({
      title: "Test issue",
      body: "Issue description",
      label: "data_quality",
    });

    expect(result).toEqual({ identifier: "DEV-9999" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.linear.app/graphql");
    expect(init!.headers).toEqual(
      expect.objectContaining({
        Authorization: "lin_api_test_key",
        "Content-Type": "application/json",
      }),
    );

    const body = JSON.parse(init!.body as string);
    expect(body.query).toContain("issueCreate");
    expect(body.variables.input).toEqual({
      teamId: "team_test_id",
      title: "Test issue",
      description: "Issue description",
      labelIds: ["uuid-data-quality"],
      priority: 1,
    });
  });

  it("maps label to UUID from env", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({
          data: { issueCreate: { issue: { identifier: "DEV-1000" } } },
        }),
      ),
    );

    // Data Quality label (as sent by report.ts linearLabelForSource)
    await createTicket({
      title: "DQ issue",
      body: "body",
      label: "Data Quality",
    });
    let body = JSON.parse(
      (fetchMock.mock.calls[0]![1]!.body as string),
    );
    expect(body.variables.input.labelIds).toEqual(["uuid-data-quality"]);

    fetchMock.mockClear();

    // Ops label (as sent by report.ts linearLabelForSource)
    await createTicket({ title: "Ops issue", body: "body", label: "Ops" });
    body = JSON.parse(
      (fetchMock.mock.calls[0]![1]!.body as string),
    );
    expect(body.variables.input.labelIds).toEqual(["uuid-ops"]);

    fetchMock.mockClear();

    // pass-through UUID (unknown key)
    await createTicket({
      title: "Custom",
      body: "body",
      label: "abc-123-uuid",
    });
    body = JSON.parse(
      (fetchMock.mock.calls[0]![1]!.body as string),
    );
    expect(body.variables.input.labelIds).toEqual(["abc-123-uuid"]);
  });

  it("maps every label on a digest ticket to its Linear UUID", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: { issueCreate: { issue: { identifier: "DEV-1001" } } },
      }),
    );

    await createTicket({
      title: "Health Agent — 3 new findings",
      body: "body",
      labels: ["Data Quality", "Ops"],
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.variables.input.labelIds).toEqual([
      "uuid-data-quality",
      "uuid-ops",
    ]);
  });

  it("includes optional project, assignee, and state when env vars are set", async () => {
    vi.stubEnv("LINEAR_PROJECT_ID", "proj_123");
    vi.stubEnv("LINEAR_ASSIGNEE_ID", "user_456");
    vi.stubEnv("LINEAR_STATE_TODO_ID", "state_789");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: {
          issueCreate: { issue: { identifier: "DEV-5000" } },
        },
      }),
    );

    await createTicket({
      title: "Full fields",
      body: "body",
      label: "data_quality",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.variables.input).toEqual({
      teamId: "team_test_id",
      title: "Full fields",
      description: "body",
      labelIds: ["uuid-data-quality"],
      priority: 1,
      projectId: "proj_123",
      assigneeId: "user_456",
      stateId: "state_789",
    });
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(
      createTicket({ title: "Fail", body: "body", label: "ops" }),
    ).rejects.toThrow(/Linear API error: 500/);
  });
});
