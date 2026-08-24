import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { BANNED_TERMS } from "../src/lib/i18n/banned-terms";
import {
  EXCLUDED_SOURCE_FILES,
  allowlistSyncProblems,
  allowlistSyncProblemsFor,
  collectViolations,
  formatViolations,
  isScannedSourceFile,
  scanJsonValue,
  scanSourceFile,
  scanText,
  scannedSourceFiles,
  stripNonProse,
} from "./check-zh-terms";

// Fixtures come from the data, never from a literal pasted into this file: a
// hardcoded copy would keep passing after the term left banned-terms.json.
const banned = BANNED_TERMS[0]!;
// A correct zh-TW word that contains a banned term as a substring — the case
// the matcher must consume whole rather than report the substring inside it.
// Re-derived from the list here rather than exported by the gate: the gate no
// longer owns the matcher, so the test must not take its fixture from it.
const bannedByTerm = new Set(BANNED_TERMS.map((entry) => entry.term));
const shield = BANNED_TERMS.map((entry) => entry.replacement).find(
  (replacement) =>
    !bannedByTerm.has(replacement) &&
    BANNED_TERMS.some(
      (other) => other.term !== replacement && replacement.includes(other.term),
    ),
)!;

// A real directory, used only as a fixture for the directory half of the
// membership rule. No entry in the real SCANNED_SOURCE_FILES is a directory
// today, so passing one in is the only way to exercise prefix matching, the
// walk that expands it, and the test-file filter that trims it.
const SCANNED_DIRECTORY_FIXTURE = "src/lib/taxonomy/";

describe("check-zh-terms — message catalogues", () => {
  it("flags a banned term in a message catalogue", () => {
    const violations = scanJsonValue(
      { brands: { filters: { appliedHint: banned.term } } },
      "messages/zh-TW.json",
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].term).toBe(banned.term);
    expect(violations[0].replacement).toBe(banned.replacement);
  });

  it("reports the key path, not the line number", () => {
    const violations = scanJsonValue(
      { brands: { filters: { appliedHint: banned.term } } },
      "messages/zh-TW.json",
    );

    expect(violations[0].location).toBe("brands.filters.appliedHint");
    expect(Object.keys(violations[0])).not.toContain("line");
  });

  it("passes the current messages/zh-TW.json", () => {
    const catalogue = JSON.parse(readFileSync("messages/zh-TW.json", "utf8"));

    expect(scanJsonValue(catalogue, "messages/zh-TW.json")).toEqual([]);
  });
});

describe("check-zh-terms — prose", () => {
  it("passes on the shielded word that contains a banned substring", () => {
    expect(shield).toBeTruthy();
    expect(scanText(shield, "content/fixture.mdx")).toEqual([]);
  });

  it("ignores a banned term inside a fenced code block", () => {
    const mdx = [
      "```ts",
      `const label = "${banned.term}";`,
      "```",
      "",
      `${banned.term}`,
    ].join("\n");

    const violations = scanText(stripNonProse(mdx), "content/fixture.mdx");

    expect(violations).toHaveLength(1);
    // Line 5 — blanking preserves offsets, so the prose hit keeps its place.
    expect(violations[0].location).toBe("5");
  });

  it("ignores banned terms in inline code and HTML comments", () => {
    const mdx = `\`${banned.term}\` <!-- ${banned.term} -->`;

    expect(scanText(stripNonProse(mdx), "content/fixture.mdx")).toEqual([]);
  });

  it("reports a line number for prose files", () => {
    const violations = scanText(`x\n${banned.term}`, "content/fixture.mdx");

    expect(violations).toHaveLength(1);
    expect(violations[0].location).toBe("2");
  });
});

describe("check-zh-terms — source scope", () => {
  it("ignores non-user-facing paths", () => {
    // src/lib/prompts.ts is full of banned terms on purpose: they are the
    // instructions telling the model which words to avoid.
    expect(isScannedSourceFile("src/lib/prompts.ts")).toBe(false);
    expect(scanSourceFile("src/lib/prompts.ts")).toEqual([]);
  });

  it("scans the taxonomy ontology, whose nameZh values are public labels", () => {
    expect(isScannedSourceFile("src/lib/taxonomy/ontology.ts")).toBe(true);
  });

  // These two are published zh-TW copy — transactional email and
  // structured-data labels. They were excluded while the gate was first
  // scoped and moved in once verified clean. This test is what stops a later
  // edit from quietly putting them back: dropping one out of
  // SCANNED_SOURCE_FILES, or re-adding it to EXCLUDED_SOURCE_FILES, fails
  // here rather than going unnoticed until a banned term ships.
  const widened = ["src/lib/email/templates.ts", "src/lib/json-ld.ts"];

  it.each(widened)("scans reader-facing %s", (entry) => {
    expect(isScannedSourceFile(entry)).toBe(true);
  });

  it.each(widened)("does not also classify %s as excluded", (entry) => {
    // The map is keyed src/-relative, the way the allowlist writes it.
    expect(EXCLUDED_SOURCE_FILES.has(entry.replace(/^src\//, ""))).toBe(false);
  });

  // One membership rule, or the enumerated set and the predicate disagree and
  // the exported `scanSourceFile` gets the looser one. The test siblings of a
  // scanned copy file are the case that must not slip through.
  it.each([
    "src/lib/taxonomy/__tests__/ontology.test.ts",
    "src/lib/taxonomy/ontology.test.tsx",
    "src/lib/email/templates.test.ts",
  ])("agrees with the file list that %s is not scanned", (file) => {
    expect(isScannedSourceFile(file)).toBe(false);
    expect(scannedSourceFiles()).not.toContain(file);
  });

  it("expands a directory entry to every non-test file beneath it", () => {
    // No real entry is a directory yet, so without a fixture the whole
    // expansion path — `walk`, the prefix match, the test-file filter — ships
    // untested and the first directory entry added is the one that discovers
    // it is broken.
    const files = scannedSourceFiles([SCANNED_DIRECTORY_FIXTURE]);

    expect(files).toContain("src/lib/taxonomy/ontology.ts");
    expect(files.length).toBeGreaterThan(1);
    expect(
      files.filter((file) => /(__tests__|\.test\.tsx?$)/.test(file)),
    ).toEqual([]);
  });

  it("drops a file beneath a scanned directory only because it is a test", () => {
    // The pair is the point: both paths sit under the same scanned directory,
    // so the ONLY thing separating them is the test-file rule. Delete that
    // rule and this goes red instead of quietly scanning fixtures that name
    // banned terms on purpose.
    expect(
      isScannedSourceFile("src/lib/taxonomy/story-tags.ts", [
        SCANNED_DIRECTORY_FIXTURE,
      ]),
    ).toBe(true);
    expect(
      isScannedSourceFile("src/lib/taxonomy/__tests__/ontology.test.ts", [
        SCANNED_DIRECTORY_FIXTURE,
      ]),
    ).toBe(false);
  });

  it("reports a renamed scan directory as a configuration problem", () => {
    // A raw ENOENT from readdirSync names neither this file nor the entry, so
    // renaming a route group would kill `pnpm lint` with an unreadable stack.
    expect(() => scannedSourceFiles(["src/app/(renamed-away)/"])).toThrow(
      /src\/app\/\(renamed-away\)\/[\s\S]*does not exist/,
    );
    expect(() => scannedSourceFiles(["src/app/(renamed-away)/"])).toThrow(
      /SCANNED_SOURCE_FILES/,
    );
  });
});

describe("check-zh-terms — allowlist sync", () => {
  it("accepts a per-file allowlist entry that a scanned DIRECTORY covers", () => {
    // The DEV-1543 bug this pins: an exact-string comparison against
    // SCANNED_SOURCE_FILES failed a normal per-file allowlist entry whose
    // directory prefix is already scanned, and told the developer to add it to
    // SCANNED_SOURCE_FILES (redundant) or EXCLUDED_SOURCE_FILES (which would
    // un-scan a file the gate had just been widened to cover). The entry must
    // be nested under a DIRECTORY entry, or a path-exact comparison passes
    // this case and the bug walks back in unnoticed.
    expect(
      allowlistSyncProblemsFor(
        ["lib/taxonomy/ontology.ts"],
        [SCANNED_DIRECTORY_FIXTURE],
      ),
    ).toEqual([]);
  });

  it("accepts a per-file allowlist entry that is itself a scanned file", () => {
    expect(allowlistSyncProblemsFor(["lib/json-ld.ts"])).toEqual([]);
  });

  it("still flags an entry that is classified nowhere", () => {
    expect(
      allowlistSyncProblemsFor(["lib/not-classified-anywhere.ts"]),
    ).toEqual([expect.stringContaining("classifies nowhere")]);
  });

  it("finds the repository's two lists in sync", () => {
    expect(allowlistSyncProblems()).toEqual([]);
  });
});

describe("check-zh-terms — repository gate", () => {
  it("finds no violations in the repository as it stands", () => {
    expect(formatViolations(collectViolations())).toBe("");
  });
});
