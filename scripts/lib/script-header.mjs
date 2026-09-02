// Shared parser and walker for the `@formoria-script` header block.
//
// Two consumers read this module: `scripts/check-script-registry.mjs` (the lint
// gate) and `scripts/list-scripts.mjs` (the catalog). Neither owns a copy of the
// parsing rules, so a format change lands in exactly one place.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

export const SCRIPT_CLASSES = new Set([
  "ci-gate",
  "generator",
  "operator",
  "validator",
  "deploy-tool",
  "scheduled-automation",
  "shared",
  "parked",
]);

export const SCRIPT_TARGETS = new Set(["staging-default", "none", "ci"]);

export const SCRIPT_SAFETY = new Set([
  "read-only",
  "dry-run-default",
  "writes-on-apply",
  "writes",
]);

export const REQUIRED_HEADER_KEYS = [
  "purpose",
  "class",
  "invoke",
  "target",
  "safety",
  "owner",
];

export const OPTIONAL_HEADER_KEYS = ["prerequisites", "notes"];

// Fixed print order for the catalog; also the order the gate reports classes in.
export const CLASS_ORDER = [
  "ci-gate",
  "generator",
  "validator",
  "operator",
  "deploy-tool",
  "scheduled-automation",
  "shared",
  "parked",
];

export const HEADER_MARKER = "@formoria-script";

export const HEADER_TEMPLATE = `/**
 * @formoria-script
 * purpose: one line stating what this script does
 * class: ${[...SCRIPT_CLASSES].join(" | ")}
 * invoke: pnpm <alias>
 * target: ${[...SCRIPT_TARGETS].join(" | ")}
 * safety: ${[...SCRIPT_SAFETY].join(" | ")}
 * owner: <team or person>
 * prerequisites: optional
 * notes: optional
 */

Use "#" comment leaders in .sh and .py files, "--" in .sql files, and a "#"
heading block in a directory's README.md.`;

const SCRIPT_EXTENSIONS = new Set([".ts", ".mjs", ".js", ".sh", ".py", ".sql"]);

// `__tests__` and `*.test.*` are exempt by design (D13); the rest are either
// generated artifacts, vendored inputs, or evaluation corpora that carry no
// operator-facing entry point.
const SKIP_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".venv",
  "__tests__",
  "backup",
  "seeds",
  "eval",
  "model-ab",
  "search-eval",
]);

// Contents of these directories are exempt: only their README.md counts as the
// directory's single entry.
const README_ONLY_DIRECTORY_NAMES = new Set(["lib", "shared"]);

const KEY_VALUE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

// Strips the comment leader from one line. Returns null when the line is not a
// comment line or closes the block, which ends the header.
function stripCommentLeader(line) {
  let text = line.trim();

  if (text.startsWith("*/")) return null;
  if (text.startsWith("/**")) text = text.slice(3);
  else if (text.startsWith("/*")) text = text.slice(2);
  else if (text.startsWith("*")) text = text.slice(1);
  else if (text.startsWith("//")) text = text.slice(2);
  else if (text.startsWith("#")) text = text.slice(1);
  else if (text.startsWith("--")) text = text.slice(2);
  else return null;

  const close = text.indexOf("*/");
  if (close >= 0) text = text.slice(0, close);

  return text.trim();
}

/**
 * Parses the first comment block opened by `@formoria-script`.
 * Returns null when the file carries no header block.
 */
export function parseScriptHeader(source) {
  if (typeof source !== "string" || !source.includes(HEADER_MARKER)) return null;

  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(HEADER_MARKER));
  if (start < 0) return null;

  const header = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = stripCommentLeader(lines[index]);
    if (text === null) break;
    if (text === "") break;

    const match = KEY_VALUE.exec(text);
    if (!match) continue;

    const key = match[1];
    if (header[key] === undefined) header[key] = match[2].trim();
  }

  // Prose that merely names the marker (this parser's own doc comment, the gate's
  // error template) is not a header block: a real one always carries keys.
  if (!REQUIRED_HEADER_KEYS.some((key) => header[key] !== undefined)) return null;

  return header;
}

/**
 * Validates a parsed header. Returns an array of human-readable problems.
 */
export function validateScriptHeader(header) {
  const problems = [];
  if (!header) return ["missing @formoria-script header block"];

  for (const key of REQUIRED_HEADER_KEYS) {
    if (!header[key]) problems.push(`missing required key: ${key}`);
  }

  const enums = [
    ["class", SCRIPT_CLASSES],
    ["target", SCRIPT_TARGETS],
    ["safety", SCRIPT_SAFETY],
  ];

  for (const [key, allowed] of enums) {
    const value = header[key];
    if (value && !allowed.has(value)) {
      problems.push(
        `invalid ${key}: ${value} (expected one of ${[...allowed].join(", ")})`,
      );
    }
  }

  return problems;
}

function isSkippedDirectory(name) {
  return name.startsWith(".") || SKIP_DIRECTORY_NAMES.has(name);
}

function isExemptFile(name) {
  if (name.startsWith(".")) return true;
  if (/\.test\.[cm]?[jt]sx?$/.test(name)) return true;
  return false;
}

function isCandidateFile(name, { readmeOnly }) {
  if (isExemptFile(name)) return false;
  if (name === "README.md") return true;
  if (readmeOnly) return false;
  return SCRIPT_EXTENSIONS.has(extname(name));
}

// A directory holding nothing but JSON (e.g. `sync-staging/`) is exempt from the
// one-entry rule: there is no script in it to document.
function isCountedFile(name) {
  return !isExemptFile(name) && extname(name) !== ".json";
}

function walkDirectory(root, relative, readmeOnly, files) {
  for (const entry of readdirSync(join(root, relative), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      if (isSkippedDirectory(entry.name)) continue;
      walkDirectory(root, join(relative, entry.name), readmeOnly, files);
      continue;
    }
    if (!entry.isFile()) continue;

    files.push({
      file: join(relative, entry.name),
      name: entry.name,
      candidate: isCandidateFile(entry.name, { readmeOnly }),
      counted: isCountedFile(entry.name),
    });
  }
}

function readEntry(root, directory, file) {
  const source = readFileSync(join(root, file.file), "utf8");
  const header = parseScriptHeader(source);

  return {
    file: file.file.replaceAll("\\", "/"),
    name: file.name,
    directory,
    extension: extname(file.name),
    header,
    problems: header ? validateScriptHeader(header) : [],
  };
}

/**
 * Walks a `scripts/` root and returns the header-relevant files.
 *
 * - `entries` — every in-scope candidate file, with its parsed header (or null)
 * - `directories` — one record per subdirectory, with its candidate entries and
 *   whether the one-entry rule applies to it
 */
export function walkScriptRoot(root) {
  const entries = [];
  const directories = [];

  if (!existsSync(root)) return { entries, directories };

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isSkippedDirectory(entry.name)) continue;

      const readmeOnly = README_ONLY_DIRECTORY_NAMES.has(entry.name);
      const files = [];
      walkDirectory(root, entry.name, readmeOnly, files);

      const directoryEntries = files
        .filter((file) => file.candidate)
        .map((file) => readEntry(root, entry.name, file));

      entries.push(...directoryEntries);
      directories.push({
        name: entry.name,
        // Exempt when the directory holds no documentable file at all.
        exempt: !files.some((file) => file.counted),
        entries: directoryEntries,
      });
      continue;
    }

    if (!entry.isFile()) continue;
    if (isExemptFile(entry.name)) continue;
    if (!SCRIPT_EXTENSIONS.has(extname(entry.name))) continue;

    entries.push(
      readEntry(root, "", {
        file: entry.name,
        name: entry.name,
        candidate: true,
        counted: true,
      }),
    );
  }

  entries.sort((a, b) => a.file.localeCompare(b.file));
  directories.sort((a, b) => a.name.localeCompare(b.name));

  return { entries, directories };
}

/**
 * Every in-scope file under `root`, with its parsed header (null when absent).
 * `options.withHeaderOnly` narrows the result to header-bearing entries, which
 * is what the catalog prints.
 */
export function collectScriptEntries(root, options = {}) {
  const { entries } = walkScriptRoot(root);
  if (options.withHeaderOnly) return entries.filter((entry) => entry.header);
  return entries;
}
