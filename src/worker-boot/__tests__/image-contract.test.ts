import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("worker image contract", () => {
  it("package scripts point at existing entry files", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    // The actual entry files are created in later tasks; assert the script
    // values reference paths under the right directories.
    expect(pkg.scripts["health:agent"]).toMatch(
      /\bsrc\/health-agent\//,
    );
    expect(pkg.scripts["repo:worker"]).toMatch(
      /\bsrc\/repo-worker\//,
    );
  });

  it("Dockerfile copies only src and manifests", () => {
    const dockerfile = readFileSync(
      resolve(ROOT, "Dockerfile.curation-worker"),
      "utf8",
    );
    const copyLines = dockerfile
      .split("\n")
      .filter((line) => /^\s*COPY\s/i.test(line));

    for (const line of copyLines) {
      expect(line).not.toMatch(/COPY\s+content\//);
      expect(line).not.toMatch(/COPY\s+supabase\//);
    }
  });

  it("Claude Code version is pinned", () => {
    const dockerfile = readFileSync(
      resolve(ROOT, "Dockerfile.curation-worker"),
      "utf8",
    );
    // Find the npm install line for Claude Code
    const installLine = dockerfile
      .split("\n")
      .find((line) => line.includes("@anthropic-ai/claude-code"));

    expect(installLine).toBeDefined();
    // Must contain an exact @x.y.z version, not `latest` or a range
    expect(installLine).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
    expect(installLine).not.toMatch(/@anthropic-ai\/claude-code@latest/);
  });

  it("Codex CLI version is pinned", () => {
    const dockerfile = readFileSync(
      resolve(ROOT, "Dockerfile.curation-worker"),
      "utf8",
    );
    const installLine = dockerfile
      .split("\n")
      .find((line) => line.includes("@openai/codex"));

    expect(installLine).toBeDefined();
    expect(installLine).toMatch(/@openai\/codex@\d+\.\d+\.\d+/);
    expect(installLine).not.toMatch(/@openai\/codex@latest/);
  });

  it("installs the PostgreSQL client used by E2E cleanup and target checks", () => {
    const dockerfile = readFileSync(
      resolve(ROOT, "Dockerfile.curation-worker"),
      "utf8",
    );

    expect(dockerfile).toMatch(/apt-get install[^\n]*postgresql-client/);
  });
});
