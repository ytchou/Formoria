import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi
    .fn()
    .mockImplementation(
      (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
        fn({ summary: {} }),
    ),
}));

import { createOpsTools, type OpsTool, type OpsToolDeps, type OpsToolContext } from "../tools";
import { OpsProposalSchema } from "../proposals";

function makeDeps(overrides: Partial<OpsToolDeps> = {}): OpsToolDeps {
  return {
    systemStatus: vi.fn().mockResolvedValue({ healthRuns: [], fixQueue: [], jobs: [] }),
    brandContext: vi.fn().mockResolvedValue({ searchResults: [] }),
    jobDetail: vi.fn().mockResolvedValue({ id: "job-1" }),
    runReadonlyQuery: vi.fn().mockResolvedValue([]),
    listErrors: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<OpsToolContext> = {}): OpsToolContext {
  return {
    onProposed: vi.fn(),
    validateProposal: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: every_tool_has_strict_schema_and_returns_json_string
// ---------------------------------------------------------------------------

describe("every tool has strict schema and returns JSON string on bad args", () => {
  it("all tools have definition.parameters and return invalid_args on bad input", async () => {
    const tools = createOpsTools(makeDeps(), makeCtx());

    expect(tools.length).toBe(7);

    for (const tool of tools) {
      expect(tool.definition.parameters).toBeDefined();
      expect(tool.definition.name).toBeTruthy();
      expect(tool.definition.description).toBeTruthy();

      // Call with bad args — should resolve (never reject) to JSON with error
      const result = await tool.run({});
      expect(typeof result).toBe("string");

      // propose_action with empty {} has a different error shape
      if (tool.definition.name !== "system_status" && tool.definition.name !== "list_errors") {
        const parsed = JSON.parse(result);
        expect(parsed.error).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: query_db_refuses_non_select_before_rpc
// ---------------------------------------------------------------------------

describe("query_db", () => {
  let tools: OpsTool[];
  let deps: OpsToolDeps;

  beforeEach(() => {
    deps = makeDeps();
    tools = createOpsTools(deps, makeCtx());
  });

  function queryDbTool(): OpsTool {
    return tools.find((t) => t.definition.name === "query_db")!;
  }

  it("refuses non-select before calling RPC", async () => {
    const result = await queryDbTool().run({ sql: "delete from brands" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("not_readonly");
    expect(deps.runReadonlyQuery).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 3: query_db_caps_output
  // ---------------------------------------------------------------------------

  it("caps output to 1536 bytes with truncated flag", async () => {
    // Generate a large result
    const longRows = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      data: "x".repeat(100),
    }));
    deps.runReadonlyQuery = vi.fn().mockResolvedValue(longRows);
    const tools2 = createOpsTools(deps, makeCtx());
    const tool = tools2.find((t) => t.definition.name === "query_db")!;

    const result = await tool.run({ sql: "select * from brands" });
    expect(result.length).toBeLessThanOrEqual(1536);

    const parsed = JSON.parse(result);
    expect(parsed.data.truncated).toBe(true);
    expect(parsed.data.rowCount).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Test 4: fire_routine tool in tool list
// ---------------------------------------------------------------------------

describe("fire_routine", () => {

  it("returns ok with description on valid args", async () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "fire_routine")!;

    const result = await tool.run({ description: "Investigate brand images" });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.description).toBe("Investigate brand images");
  });

  it("returns error on invalid args", async () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "fire_routine")!;

    const result = await tool.run({});
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("invalid_args");
  });
});

// ---------------------------------------------------------------------------
// Test 4b: query_posthog removed
// ---------------------------------------------------------------------------

describe("query_posthog removed", () => {
  it("no query_posthog tool exists", () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const posthog = tools.find((t) => t.definition.name === "query_posthog");
    expect(posthog).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 5: list_errors_clamps_hours
// ---------------------------------------------------------------------------

describe("list_errors", () => {
  it("clamps hours to 1..168", async () => {
    const deps = makeDeps();
    const tools = createOpsTools(deps, makeCtx());
    const tool = tools.find((t) => t.definition.name === "list_errors")!;

    await tool.run({ hours: 0 });
    expect(deps.listErrors).toHaveBeenCalledWith(1);

    vi.clearAllMocks();

    await tool.run({ hours: 999 });
    expect(deps.listErrors).toHaveBeenCalledWith(168);

    vi.clearAllMocks();

    await tool.run({ hours: 48 });
    expect(deps.listErrors).toHaveBeenCalledWith(48);
  });
});

// ---------------------------------------------------------------------------
// Test 6: system_status_runs_reads_in_parallel_with_partial_result
// ---------------------------------------------------------------------------

describe("system_status tool", () => {
  it("one reader rejecting yields partial result with that key as error", async () => {
    const deps = makeDeps({
      systemStatus: vi.fn().mockResolvedValue({
        healthRuns: [{ id: "run-1" }],
        fixQueue: { error: "db error" },
        jobs: [{ id: "job-1" }],
      }),
    });
    const tools = createOpsTools(deps, makeCtx());
    const tool = tools.find((t) => t.definition.name === "system_status")!;

    const result = await tool.run({});
    const parsed = JSON.parse(result);
    expect(parsed.data.healthRuns).toBeDefined();
    expect(parsed.data.fixQueue).toEqual({ error: "db error" });
    expect(parsed.data.jobs).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 8: propose_action_success_calls_on_proposed
// ---------------------------------------------------------------------------

describe("propose_action", () => {
  it("exposes an OpenAI-compatible root object schema", () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "propose_action")!;

    expect(tool.definition.parameters).toMatchObject({
      type: "object",
      required: ["kind"],
      additionalProperties: false,
    });
    expect(tool.definition.parameters).not.toHaveProperty("oneOf");
  });

  it("valid action invokes onProposed and returns ok", async () => {
    const onProposed = vi.fn();
    const validateProposal = vi.fn().mockResolvedValue({ ok: true });
    const tools = createOpsTools(makeDeps(), { onProposed, validateProposal });
    const tool = tools.find((t) => t.definition.name === "propose_action")!;

    const result = await tool.run({
      kind: "refresh_brand",
      slug: "test-brand",
    });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(onProposed).toHaveBeenCalledOnce();
    expect(onProposed).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "refresh_brand", slug: "test-brand" }),
    );
  });

  it("run-e2e proposal without mode defaults to preflight", async () => {
    const onProposed = vi.fn();
    const tools = createOpsTools(makeDeps(), makeCtx({ onProposed }));
    const tool = tools.find((t) => t.definition.name === "propose_action")!;

    const result = await tool.run({ kind: "dispatch_workflow", workflow: "e2e-staging" });
    expect(JSON.parse(result).ok).toBe(true);
    expect(onProposed).toHaveBeenCalledWith({
      kind: "dispatch_workflow",
      workflow: "e2e-staging",
      mode: "preflight",
    });
  });

  it("malformed proposal names the failing field", async () => {
    const onProposed = vi.fn();
    const tools = createOpsTools(makeDeps(), makeCtx({ onProposed }));
    const tool = tools.find((t) => t.definition.name === "propose_action")!;

    const parsed = JSON.parse(await tool.run({ kind: "rerun_job", jobId: "j1" }));
    expect(parsed.error).toBe("invalid_args");
    expect(parsed.issues).toEqual([expect.stringMatching(/^mode: /)]);
    expect(onProposed).not.toHaveBeenCalled();
  });

  it("invalid proposal returns error without calling onProposed", async () => {
    const onProposed = vi.fn();
    const validateProposal = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "unknown_brand" });
    const tools = createOpsTools(makeDeps(), { onProposed, validateProposal });
    const tool = tools.find((t) => t.definition.name === "propose_action")!;

    const result = await tool.run({
      kind: "refresh_brand",
      slug: "no-brand",
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("unknown_brand");
    expect(onProposed).not.toHaveBeenCalled();
  });

  it("has no instruction property and describes every property", () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "propose_action")!;
    const params = tool.definition.parameters as {
      properties: Record<string, { description?: string }>;
    };
    expect(params.properties).not.toHaveProperty("instruction");
    expect(Object.keys(params.properties)).toEqual([
      "kind",
      "slug",
      "jobId",
      "mode",
      "workflow",
    ]);
    for (const [name, prop] of Object.entries(params.properties)) {
      expect(prop.description, name).toBeTruthy();
    }
  });

  it("description names the confirm step and the real return shapes", () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "propose_action")!;
    const description = tool.definition.description ?? "";
    expect(description).toContain("nothing runs until they confirm");
    expect(description).toContain("{ok:true}");
    expect(description).toContain('"invalid_args"');
    expect(description).toContain('"unknown_brand"');
  });

  it("has 3 kinds (no code_fix)", () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "propose_action")!;
    const params = tool.definition.parameters as {
      properties: { kind: { enum: string[] } };
    };
    expect(params.properties.kind.enum).toEqual([
      "refresh_brand",
      "rerun_job",
      "dispatch_workflow",
    ]);
  });

  it("flat tool-schema enums match OpsProposalSchema (#1175 drift guard)", () => {
    const tools = createOpsTools(makeDeps(), makeCtx());
    const tool = tools.find((t) => t.definition.name === "propose_action")!;
    const params = tool.definition.parameters as {
      properties: {
        kind: { enum: string[] };
        mode: { enum: string[] };
        workflow: { enum: string[] };
      };
    };
    const variants = OpsProposalSchema.options;
    const byKind = (kind: string) =>
      variants.find((v) => v.shape.kind.value === kind)!;
    const rerunJob = byKind("rerun_job") as (typeof variants)[1];
    const dispatchWorkflow = byKind("dispatch_workflow") as (typeof variants)[2];

    expect(params.properties.kind.enum).toEqual(
      variants.map((v) => v.shape.kind.value),
    );
    expect(params.properties.mode.enum).toEqual(rerunJob.shape.mode.options);
    expect(params.properties.workflow.enum).toEqual(
      dispatchWorkflow.shape.workflow.options,
    );
  });
});
