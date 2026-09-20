import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = [
  ".github/workflows/e2e-nightly.yml",
  ".github/workflows/health-agent.yml",
  ".github/workflows/ops-fix.yml",
] as const;
const CODEX_ACTION =
  "openai/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e";
const SCHEMAS = [
  ".github/codex/e2e-diagnosis.schema.json",
  ".github/codex/e2e-repair.schema.json",
  ".github/codex/health-repair.schema.json",
  ".github/codex/health-repair-cycle-2.schema.json",
  ".github/codex/health-review.schema.json",
  ".github/codex/health-review-cycle-2.schema.json",
] as const;

describe("Codex workflow migration", () => {
  it("keeps active agent workflows on the pinned Codex action and dedicated secret", () => {
    for (const path of WORKFLOWS) {
      const workflow = readFileSync(path, "utf8");

      expect(() => parse(workflow)).not.toThrow();
      expect(workflow).toContain(CODEX_ACTION);
      expect(workflow).toContain("secrets.CODEX_API_KEY");
      expect(workflow).toContain("codex-version: 0.155.1");
      expect(workflow).not.toContain("anthropics/claude-code-action");
      expect(workflow).not.toContain("secrets.CLAUDE_CODE_OAUTH_TOKEN");
      expect(workflow).not.toContain("outputs.structured_output");
    }
  });

  it("keeps read-only analysis separate from workspace repair", () => {
    const e2e = readFileSync(WORKFLOWS[0], "utf8");
    const health = readFileSync(WORKFLOWS[1], "utf8");
    const ops = readFileSync(WORKFLOWS[2], "utf8");

    expect(e2e).toContain('permission-profile: ":read-only"');
    expect(e2e).toContain('permission-profile: ":workspace"');
    expect(health).toContain('permission-profile: ":read-only"');
    expect(health).toContain('permission-profile: ":workspace"');
    expect(ops).toContain('permission-profile: ":workspace"');
  });

  it("keeps every structured-output object closed and fully required", () => {
    for (const path of SCHEMAS) {
      const schema = JSON.parse(readFileSync(path, "utf8")) as unknown;
      expectStrictObjectSchemas(schema);
    }
  });
});

function expectStrictObjectSchemas(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const schema = value as Record<string, unknown>;
  if (schema.type === "object") {
    expect(schema.additionalProperties, "additionalProperties").toBe(false);
    const properties = schema.properties as Record<string, unknown>;
    expect([...(schema.required as string[])].sort()).toEqual(
      Object.keys(properties).sort(),
    );
    for (const property of Object.values(properties)) {
      expectStrictObjectSchemas(property);
    }
  }
  if (schema.type === "array") expectStrictObjectSchemas(schema.items);
}
