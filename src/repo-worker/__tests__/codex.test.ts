import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { auditedCall } from "@/lib/audit";
import {
  buildCodexArgs,
  buildCodexEnv,
  parseCodexJsonl,
  parseCodexStructuredOutput,
  runCodexAgent,
} from "../codex";

const schema = {
  type: "object",
  properties: { status: { type: "string" } },
  required: ["status"],
  additionalProperties: false,
};

describe("repo-worker Codex adapter", () => {
  it("maps read and write access to the matching Codex sandbox", () => {
    const readArgs = buildCodexArgs(
      { prompt: "Inspect", access: "read", jsonSchema: schema },
      "/tmp/schema.json",
      "/tmp/output.json",
    );
    const writeArgs = buildCodexArgs(
      { prompt: "Repair", access: "write", jsonSchema: schema },
      "/tmp/schema.json",
      "/tmp/output.json",
    );

    expect(readArgs).toContain("read-only");
    expect(writeArgs).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(writeArgs).not.toContain("workspace-write");
    expect(readArgs).toContain("--output-schema");
    expect(readArgs).toContain("--output-last-message");
    expect(readArgs).toContain('shell_environment_policy.inherit="core"');
    expect(readArgs).toContain(
      "shell_environment_policy.ignore_default_excludes=false",
    );
  });

  it("resumes the requested session without opening a new sandbox policy", () => {
    const args = buildCodexArgs(
      {
        prompt: "Continue",
        access: "write",
        jsonSchema: schema,
        resumeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      },
      "/tmp/schema.json",
      "/tmp/output.json",
    );

    expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(args).toContain("0199a213-81c0-7800-8aa1-bbab2a035a53");
    expect(args).not.toContain("--sandbox");
  });

  it("exposes only the dedicated credential and minimal process environment", () => {
    const env = buildCodexEnv("codex-test-key");

    expect(Object.keys(env).sort()).toEqual(["HOME", "OPENAI_API_KEY", "PATH"]);
    expect(env.OPENAI_API_KEY).toBe("codex-test-key");
  });

  it("parses the thread and token usage from Codex JSONL", () => {
    const parsed = parseCodexJsonl(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 120, output_tokens: 24 },
        }),
      ].join("\n"),
    );

    expect(parsed).toEqual({
      sessionId: "thread-123",
      usage: { input_tokens: 120, output_tokens: 24 },
    });
  });

  it("rejects empty and non-JSON final output", () => {
    expect(() => parseCodexStructuredOutput("  ")).toThrow(
      /no structured output/i,
    );
    expect(() => parseCodexStructuredOutput("not-json")).toThrow(/non-JSON/i);
  });

  it("rejects JSON that does not satisfy the requested output schema", () => {
    expect(() =>
      parseCodexStructuredOutput('{"unexpected":true}', schema),
    ).toThrow(/did not match schema/i);
  });

  it("returns the schema-constrained final output from an audited execution", async () => {
    let auditSummary: Record<string, unknown> | undefined;
    const processCalls: Array<{ args: string[]; stdin: string }> = [];
    const audit: typeof auditedCall = async (_spec, fn) => {
      const context = { summary: {} };
      const value = await fn(context);
      auditSummary = context.summary;
      return value;
    };
    const result = await runCodexAgent(
      "/tmp/repository",
      { prompt: "Inspect", access: "read", jsonSchema: schema },
      {
        apiKey: "codex-test-key",
        audit,
        runProcess: async (args, _cwd, _env, stdin) => {
          processCalls.push({ args, stdin });
          if (args[0] === "login") {
            return {
              stdout: "",
              stderr: "",
              exitCode: 0,
              signal: null,
            };
          }
          const outputIndex = args.indexOf("--output-last-message");
          await writeFile(args[outputIndex + 1]!, '{"status":"ok"}', "utf8");
          return {
            stdout: [
              JSON.stringify({
                type: "thread.started",
                thread_id: "thread-123",
              }),
              JSON.stringify({
                type: "turn.completed",
                usage: { input_tokens: 12, output_tokens: 4 },
              }),
            ].join("\n"),
            stderr: "",
            exitCode: 0,
            signal: null,
          };
        },
      },
    );

    expect(result).toEqual({
      structuredOutput: { status: "ok" },
      sessionId: "thread-123",
      usage: { input_tokens: 12, output_tokens: 4 },
    });
    expect(processCalls[0]).toEqual({
      args: ["login", "--with-api-key"],
      stdin: "codex-test-key",
    });
    expect(auditSummary).toMatchObject({
      request: { prompt: "Inspect", jsonSchema: schema },
      response: result,
      exitCode: 0,
    });
  });
});
