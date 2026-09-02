#!/usr/bin/env node
// Prints the script catalog from the `@formoria-script` header blocks.
//
// The headers are the single source of truth: `scripts/README.md` documents the
// convention, this command lists what exists.

import { pathToFileURL } from "node:url";

import { CLASS_ORDER, collectScriptEntries } from "./lib/script-header.mjs";

function formatEntry(entry) {
  const header = entry.header;
  const detail = [header.invoke, header.target, header.safety, header.owner]
    .map((value) => value ?? "-")
    .join(" · ");

  return `${entry.file} — ${header.purpose ?? "-"} (${detail})`;
}

export function renderScriptCatalog(root = "scripts") {
  const entries = collectScriptEntries(root, { withHeaderOnly: true });
  if (entries.length === 0) return "";

  const byClass = new Map();
  for (const entry of entries) {
    const className = entry.header.class ?? "unclassified";
    const bucket = byClass.get(className) ?? [];
    bucket.push(entry);
    byClass.set(className, bucket);
  }

  // Fixed order first; anything outside the enum trails alphabetically so a
  // typo'd class is visible rather than silently dropped.
  const ordered = [
    ...CLASS_ORDER,
    ...[...byClass.keys()].filter((name) => !CLASS_ORDER.includes(name)).sort(),
  ];

  const lines = [];
  for (const className of ordered) {
    const bucket = byClass.get(className);
    if (!bucket || bucket.length === 0) continue;

    if (lines.length > 0) lines.push("");
    lines.push(className);
    for (const entry of bucket) lines.push(`  ${formatEntry(entry)}`);
  }

  return lines.join("\n");
}

function parseArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") return argv[index + 1];
    if (arg.startsWith("--root=")) return arg.slice("--root=".length);
  }
  return "scripts";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const catalog = renderScriptCatalog(parseArgv(process.argv.slice(2)));
  if (catalog) console.log(catalog);
}
