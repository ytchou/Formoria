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
 * owner: engineering
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
        // A colon and a CJK word inside the purpose: the catalog prints the
        // value the parser produced, so both have to survive the round trip.
        purpose:
          "Removes a brand and every row that belongs to it: images, channels, 品牌 aliases",
        className: "operator",
        invoke: "pnpm remove-brand -- --slug <slug>",
      }),
    );
    write(
      root,
      "check-thing.mjs",
      header({
        purpose: "Fails the lint chain when a script carries no header",
        className: "ci-gate",
        invoke: "pnpm check:script-registry",
      }),
    );

    const output = renderScriptCatalog(root);

    expect(output).toContain(
      "check-thing.mjs — Fails the lint chain when a script carries no header (pnpm check:script-registry · ci · read-only · engineering)",
    );
    expect(output).toContain(
      "remove-brand.ts — Removes a brand and every row that belongs to it: images, channels, 品牌 aliases (pnpm remove-brand -- --slug <slug> · ci · read-only · engineering)",
    );
    expect(output.indexOf("ci-gate")).toBeLessThan(output.indexOf("operator"));
  });

  it("exits 0 and prints nothing for an empty root", () => {
    const root = mkdtempSync(join(tmpdir(), "list-scripts-empty-"));

    expect(renderScriptCatalog(root)).toBe("");
  });
});
