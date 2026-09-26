/**
 * DEV-1824 D2: TypeSafe Jev stays eval-only. No page, component or runtime
 * service may import the Jev client, its audited wrapper, or the Jev question
 * bank, and no production LLM profile may route to a Jev model. Remove this
 * guard only in the ticket that deliberately switches a phase onto Jev.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JEV_MODEL,
  LLM_MODELS,
  LLM_PROFILES,
} from "@/lib/constants/llm-models";

const ROOT = process.cwd();

/**
 * Matches only module specifiers (static/dynamic import, export-from, require),
 * so a comment that names `typesafe-audit.ts` does not trip the guard.
 */
const JEV_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"][^'"]*\b(?:typesafe-audit|typesafe-client|jev-questions)(?:\.[cm]?[jt]sx?)?['"]/;

function importsJev(source: string): boolean {
  return JEV_IMPORT.test(source);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function violations(files: readonly string[]): string[] {
  return files
    .filter((file) => importsJev(readFileSync(file, "utf8")))
    .map((file) => relative(ROOT, file));
}

/** Legitimate Jev importers: the eval harness, the Jev modules themselves, tests. */
function isAllowedLibImporter(file: string): boolean {
  const rel = relative(ROOT, file).split(sep).join("/");
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return (
    rel.startsWith("src/lib/services/eval/") ||
    name.startsWith("typesafe-") ||
    rel.includes("/__tests__/") ||
    /\.test\.[cm]?[jt]sx?$/.test(name)
  );
}

describe("Jev stays eval-only (DEV-1824 D2)", () => {
  it("no file under src/app or src/components imports typesafe-audit, typesafe-client or jev-questions", () => {
    const files = [
      ...sourceFiles(join(ROOT, "src", "app")),
      ...sourceFiles(join(ROOT, "src", "components")),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it("no runtime file under src/lib outside the eval harness imports Jev code", () => {
    const files = sourceFiles(join(ROOT, "src", "lib")).filter(
      (file) => !isAllowedLibImporter(file),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it("the matcher flags Jev imports and ignores unrelated ones", () => {
    expect(
      importsJev(`import { decide } from '@/lib/services/typesafe-audit'`),
    ).toBe(true);
    expect(importsJev(`} from "./typesafe-client";`)).toBe(true);
    expect(importsJev(`export type { DecideFn } from '../jev-questions'`)).toBe(
      true,
    );
    expect(
      importsJev(`const m = await import("@/lib/services/eval/jev-questions")`),
    ).toBe(true);
    expect(
      importsJev(`import { callLlm } from '@/lib/services/llm-audit'`),
    ).toBe(false);
    expect(importsJev(`// eval-only (typesafe-audit.ts).`)).toBe(false);
  });

  it("no LLM_PROFILES entry references typesafe", () => {
    const jevProfiles = Object.entries(LLM_PROFILES)
      .filter(([, profile]) => {
        const model: string = LLM_MODELS[profile.model];
        return model === JEV_MODEL || model.startsWith("jev");
      })
      .map(([key]) => key);
    expect(jevProfiles).toEqual([]);
  });

  it("no LLM_MODELS entry is a Jev model", () => {
    expect(
      Object.values(LLM_MODELS).filter(
        (model: string) => model === JEV_MODEL || model.startsWith("jev"),
      ),
    ).toEqual([]);
  });
});
