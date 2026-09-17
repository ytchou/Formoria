import { beforeAll, describe, expect, it } from "vitest";

/**
 * Tests for the repo-worker Claude Code integration.
 *
 * All process spawning is injected via DI seams, so tests never start a
 * real Claude Code process.
 */

describe("repo-worker claude", () => {
  let buildClaudeArgs: typeof import("../claude").buildClaudeArgs;
  let buildClaudeEnv: typeof import("../claude").buildClaudeEnv;

  beforeAll(async () => {
    ({ buildClaudeArgs, buildClaudeEnv } = await import("../claude"));
  });

  // -------------------------------------------------------------------------
  // Test 5: claude is spawned with an environment containing only
  //         CLAUDE_CODE_OAUTH_TOKEN, PATH and HOME
  // -------------------------------------------------------------------------
  it("claude is spawned with an environment containing only CLAUDE_CODE_OAUTH_TOKEN, PATH and HOME", () => {
    const env = buildClaudeEnv({ oauthToken: "tok_123" });

    // Must contain exactly these keys
    expect(Object.keys(env).sort()).toEqual(
      ["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "PATH"].sort(),
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok_123");
    expect(env.PATH).toBeDefined();
    expect(env.HOME).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 6: claude is invoked non-bare with allowedTools, max-turns,
  //         json-schema and resume when given
  // -------------------------------------------------------------------------
  it("claude is invoked non-bare with allowedTools, max-turns, json-schema and resume when given", () => {
    const schema = { type: "object", properties: { fix: { type: "string" } } };
    const args = buildClaudeArgs({
      prompt: "Fix the bug",
      allowedTools: ["Read", "Edit", "Bash"],
      maxTurns: 5,
      jsonSchema: schema,
    });

    // Must NOT contain --print (non-bare / interactive mode equivalent)
    // The CLI uses -p for prompt, --allowedTools, --max-turns, --output-format
    expect(args).toContain("--max-turns");
    expect(args).toContain("5");

    expect(args).toContain("--allowedTools");
    expect(args).toContain("Read,Edit,Bash");

    expect(args).toContain("--output-format");
    expect(args).toContain("json");

    // Prompt is passed via -p
    expect(args).toContain("-p");
    expect(args).toContain("Fix the bug");

    // json-schema is passed via --output-schema
    expect(args).toContain("--output-schema");
    const schemaArgIdx = args.indexOf("--output-schema");
    expect(JSON.parse(args[schemaArgIdx + 1])).toEqual(schema);

    // No --resume when resumeSessionId is absent
    expect(args).not.toContain("--resume");
  });

  it("claude includes --resume when resumeSessionId is provided", () => {
    const args = buildClaudeArgs({
      prompt: "Continue fixing",
      allowedTools: ["Edit"],
      maxTurns: 3,
      jsonSchema: {},
      resumeSessionId: "session-abc-123",
    });

    expect(args).toContain("--resume");
    expect(args).toContain("session-abc-123");
  });
});
