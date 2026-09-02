import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderScriptCatalog } from "../list-scripts.mjs";

function write(root: string, file: string, source: string) {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
}

function header({
  purpose,
  className,
  invoke,
}: {
  purpose: string;
  className: string;
  invoke: string;
}) {
  return `/**
 * @formoria-script
 * purpose: ${purpose}
 * class: ${className}
 * invoke: ${invoke}
 * target: ci
 * safety: read-only
 * owner: platform
 */
export {};
`;
}

describe("list-scripts", () => {
  it("groups entries by class in a fixed order", () => {
    const root = mkdtempSync(join(tmpdir(), "list-scripts-"));
    write(
      root,
      "remove-brand.ts",
      header({
        purpose: "removes a brand",
        className: "operator",
        invoke: "pnpm remove-brand",
      }),
    );
    write(
      root,
      "check-thing.mjs",
      header({
        purpose: "guards a thing",
        className: "ci-gate",
        invoke: "pnpm check:thing",
      }),
    );

    const output = renderScriptCatalog(root);

    expect(output).toContain(
      "check-thing.mjs — guards a thing (pnpm check:thing · ci · read-only · platform)",
    );
    expect(output).toContain(
      "remove-brand.ts — removes a brand (pnpm remove-brand · ci · read-only · platform)",
    );
    expect(output.indexOf("ci-gate")).toBeLessThan(output.indexOf("operator"));
  });

  it("exits 0 and prints nothing for an empty root", () => {
    const root = mkdtempSync(join(tmpdir(), "list-scripts-empty-"));

    expect(renderScriptCatalog(root)).toBe("");
  });
});
