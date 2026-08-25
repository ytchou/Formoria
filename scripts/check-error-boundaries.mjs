import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ACTION_ROOTS = [
  "src/app/[locale]/(site)/(protected)/settings",
  "src/app/[locale]/(site)/brands/[slug]",
  "src/app/[locale]/(site)/submit",
  "src/app/admin",
  "src/app/auth",
];
const LIB_ACTION_DIR = "src/lib/actions";
const APP_ACTION_DIR = "src/app/actions";
const API_ROOT = "src/app/api";

const CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
const REPORT_AND_RETURN_RE = /\breportAndReturn\b/;
const CAPTURE_EXCEPTION_RE = /\bcaptureException\b/;

function walk(directory, filter) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (entry === "__tests__" || entry === "node_modules") continue;
    if (statSync(path).isDirectory()) files.push(...walk(path, filter));
    else if (filter(path)) files.push(path);
  }
  return files;
}

function findActionFiles() {
  const files = [];
  for (const root of ACTION_ROOTS) {
    const candidate = join(root, "actions.ts");
    if (existsSync(candidate)) files.push(candidate);
    files.push(...walk(root, (p) => p.endsWith("/actions.ts") && !p.includes("__tests__")));
  }
  for (const dir of [LIB_ACTION_DIR, APP_ACTION_DIR]) {
    files.push(
      ...walk(dir, (p) => [".ts", ".tsx"].includes(extname(p)) && !p.endsWith(".test.ts")),
    );
  }
  return [...new Set(files)];
}

function findApiFiles() {
  return walk(API_ROOT, (p) => p.endsWith("route.ts"));
}

function findCatchBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(CATCH_RE)) {
    const line = source.slice(0, match.index).split("\n").length;
    let depth = 0;
    let body = "";
    for (let i = match.index + match[0].length; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        if (depth === 0) break;
        depth--;
      }
      body += source[i];
    }
    blocks.push({ line, body });
  }
  return blocks;
}

const violations = [];

for (const file of findActionFiles()) {
  const source = readFileSync(file, "utf8");
  for (const block of findCatchBlocks(source)) {
    if (!REPORT_AND_RETURN_RE.test(block.body) && !CAPTURE_EXCEPTION_RE.test(block.body)) {
      violations.push(`${relative(".", file)}:${block.line}`);
    }
  }
}

for (const file of findApiFiles()) {
  const source = readFileSync(file, "utf8");
  for (const block of findCatchBlocks(source)) {
    if (!CAPTURE_EXCEPTION_RE.test(block.body)) {
      violations.push(`${relative(".", file)}:${block.line}`);
    }
  }
}

if (violations.length > 0) {
  console.log(
    `Error boundary check: ${violations.length} catch block(s) missing error reporting:`,
  );
  for (const v of violations) console.log(`  ${v}`);
  console.log(
    "\nAction files need reportAndReturn or captureException; API routes need captureException.",
  );
}

console.log(`\nError boundary backlog: ${violations.length} violation(s)`);
