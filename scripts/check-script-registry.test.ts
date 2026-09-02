import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectScriptRegistryViolations } from "./check-script-registry.mjs";
import { parseScriptHeader } from "./lib/script-header.mjs";

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "script-registry-"));
}

function write(root: string, file: string, source: string) {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
}

function blockHeader({
  purpose = "does a thing",
  className = "operator",
  invoke = "pnpm do-thing",
  target = "staging-default",
  safety = "read-only",
  owner = "platform",
} = {}) {
  return `/**
 * @formoria-script
 * purpose: ${purpose}
 * class: ${className}
 * invoke: ${invoke}
 * target: ${target}
 * safety: ${safety}
 * owner: ${owner}
 */
export {};
`;
}

function hashHeader(leader: string) {
  return `${leader} @formoria-script
${leader} purpose: does a thing
${leader} class: operator
${leader} invoke: pnpm do-thing
${leader} target: staging-default
${leader} safety: read-only
${leader} owner: platform
`;
}

const packageJson = (scripts: Record<string, string>) =>
  JSON.stringify({ name: "fixture", scripts }, null, 2);

function messagesFor(
  violations: { file: string; message: string }[],
  file: string,
) {
  return violations
    .filter((violation) => violation.file === file)
    .map((violation) => violation.message);
}

describe("script header parser", () => {
  it("parses a header block from a ts file", () => {
    const header = parseScriptHeader(blockHeader());

    expect(header).toEqual({
      purpose: "does a thing",
      class: "operator",
      invoke: "pnpm do-thing",
      target: "staging-default",
      safety: "read-only",
      owner: "platform",
    });
  });

  it("parses a header block from sh, py and sql comment syntaxes", () => {
    const shell = parseScriptHeader(`#!/usr/bin/env bash\n${hashHeader("#")}`);
    const python = parseScriptHeader(hashHeader("#"));
    const sql = parseScriptHeader(hashHeader("--"));

    expect(shell).toEqual(parseScriptHeader(blockHeader()));
    expect(python).toEqual(shell);
    expect(sql).toEqual(shell);
  });
});

describe("check-script-registry", () => {
  it("reports a file with no header", () => {
    const root = fixtureRoot();
    write(root, "bare.ts", "export const value = 1;\n");

    const violations = collectScriptRegistryViolations({
      root,
      packageFile: null,
    });

    expect(messagesFor(violations, "bare.ts")).toEqual([
      "missing @formoria-script header block",
    ]);
  });

  it("reports a header with an invalid class or missing required key", () => {
    const root = fixtureRoot();
    write(root, "wrong-class.ts", blockHeader({ className: "mystery" }));
    write(
      root,
      "missing-key.ts",
      blockHeader().replace(/^ \* owner: .*$/m, " * unrelated: x"),
    );

    const violations = collectScriptRegistryViolations({
      root,
      packageFile: null,
    });

    expect(messagesFor(violations, "wrong-class.ts")).toEqual([
      expect.stringContaining("invalid class: mystery"),
    ]);
    expect(messagesFor(violations, "missing-key.ts")).toEqual([
      "missing required key: owner",
    ]);
  });

  it("reports a package.json script whose path does not exist", () => {
    const root = fixtureRoot();
    const packageFile = join(root, "package.json");
    write(root, "package.json", packageJson({ x: "tsx scripts/missing.ts" }));

    const violations = collectScriptRegistryViolations({ root, packageFile });

    expect(messagesFor(violations, packageFile)).toEqual([
      'script "x" references scripts/missing.ts, which does not exist',
    ]);
  });

  it("reports an invoke alias absent from package.json", () => {
    const root = fixtureRoot();
    const packageFile = join(root, "package.json");
    write(root, "package.json", packageJson({ known: "tsx scripts/known.ts" }));
    write(root, "known.ts", blockHeader({ invoke: "pnpm nope" }));

    const violations = collectScriptRegistryViolations({ root, packageFile });

    expect(messagesFor(violations, "known.ts")).toEqual([
      'invoke names "pnpm nope", which is not a package.json script',
    ]);
  });

  it("exempts tests, __tests__, lib and shared contents, and json", () => {
    const root = fixtureRoot();
    write(root, "helper.test.ts", "export const value = 1;\n");
    write(root, "fixture.json", "{}\n");
    write(root, "__tests__/probe.ts", "export const value = 1;\n");
    write(root, "lib/util.mjs", "export const value = 1;\n");
    write(root, "lib/README.md", hashHeader("#"));
    write(root, "shared/target.ts", "export const value = 1;\n");
    write(root, "shared/README.md", hashHeader("#"));

    const violations = collectScriptRegistryViolations({
      root,
      packageFile: null,
    });

    expect(violations.map((violation) => violation.file)).toEqual([]);
  });

  it("requires exactly one header file per subdirectory", () => {
    const root = fixtureRoot();
    write(root, "zero/run.ts", "export const value = 1;\n");
    write(root, "two/first.ts", blockHeader());
    write(root, "two/second.ts", blockHeader());
    write(root, "one/entry.ts", blockHeader());
    write(root, "one/support.ts", "export const value = 1;\n");
    write(root, "json-only/data.json", "{}\n");

    const violations = collectScriptRegistryViolations({
      root,
      packageFile: null,
    });

    expect(messagesFor(violations, "zero/")).toEqual([
      expect.stringContaining("no file carries an @formoria-script header"),
    ]);
    expect(messagesFor(violations, "two/")).toEqual([
      expect.stringContaining("2 files carry an @formoria-script header"),
    ]);
    expect(messagesFor(violations, "one/")).toEqual([]);
    expect(messagesFor(violations, "json-only/")).toEqual([]);
  });
});
