#!/usr/bin/env node
/**
 * @formoria-script
 * purpose: Fails the lint chain when a script under scripts/ carries no valid @formoria-script header.
 * class: ci-gate
 * invoke: pnpm check:script-registry
 * target: none
 * safety: read-only
 * owner: engineering
 */
// Lint gate for the `@formoria-script` registry (DEV-1318).
//
// Fails when a script under `scripts/` carries no header block, when a header is
// incomplete or names a value outside the enums, when a package.json alias points
// at a file that does not exist, or when a header's `invoke` names an alias that
// package.json does not define.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  HEADER_TEMPLATE,
  HEADER_TEMPLATE_NOTE,
  walkScriptRoot,
} from "./lib/script-header.mjs";

const SCRIPT_PATH_REFERENCE =
  /scripts\/[A-Za-z0-9_@.\-/]+\.(?:mts|ts|mjs|js|sh|py|sql)/g;

// `pnpm exec`/`pnpm dlx` run a binary, not an alias, so there is nothing to
// cross-check against package.json.
const NON_ALIAS_PNPM_WORDS = new Set(["exec", "dlx", "--"]);

function readPackageScripts(packageFile) {
  if (!packageFile || !existsSync(packageFile)) return null;

  try {
    const parsed = JSON.parse(readFileSync(packageFile, "utf8"));
    return parsed.scripts ?? {};
  } catch {
    return null;
  }
}

function aliasFromInvoke(invoke) {
  const words = invoke.trim().split(/\s+/);
  if (words[0] !== "pnpm") return null;

  let alias = words[1];
  if (alias === "run") alias = words[2];
  if (!alias || NON_ALIAS_PNPM_WORDS.has(alias)) return null;
  if (alias.startsWith("-")) return null;

  return alias;
}

export function collectScriptRegistryViolations({
  root = "scripts",
  packageFile = "package.json",
} = {}) {
  const violations = [];
  const { entries, directories } = walkScriptRoot(root);

  for (const entry of entries) {
    if (!entry.header) {
      // Only top-level files are individually required to carry a header;
      // subdirectories are covered by the one-entry rule below.
      if (entry.directory === "") {
        violations.push({
          file: entry.file,
          message: "missing @formoria-script header block",
        });
      }
      continue;
    }

    for (const problem of entry.problems) {
      violations.push({ file: entry.file, message: problem });
    }
  }

  for (const directory of directories) {
    if (directory.exempt) continue;

    const documented = directory.entries.filter((entry) => entry.header);
    if (documented.length === 1) continue;

    violations.push({
      file: `${directory.name}/`,
      message:
        documented.length === 0
          ? "no file carries an @formoria-script header block; exactly one entry file is required"
          : `${documented.length} files carry an @formoria-script header block (${documented
              .map((entry) => entry.file)
              .join(", ")}); exactly one entry file is required`,
    });
  }

  const packageScripts = readPackageScripts(packageFile);
  if (packageScripts) {
    for (const [alias, command] of Object.entries(packageScripts)) {
      for (const match of String(command).matchAll(SCRIPT_PATH_REFERENCE)) {
        const referenced = match[0];
        const resolved = join(root, referenced.slice("scripts/".length));
        if (existsSync(resolved)) continue;

        violations.push({
          file: packageFile,
          message: `script "${alias}" references ${referenced}, which does not exist`,
        });
      }
    }

    const aliases = new Set(Object.keys(packageScripts));
    for (const entry of entries) {
      const invoke = entry.header?.invoke;
      if (!invoke) continue;

      const alias = aliasFromInvoke(invoke);
      if (!alias || aliases.has(alias)) continue;

      violations.push({
        file: entry.file,
        message: `invoke names "pnpm ${alias}", which is not a package.json script`,
      });
    }
  }

  return violations;
}

export function reportScriptRegistryViolations(violations) {
  if (violations.length > 0) {
    console.error("Script registry guard failed:");
    for (const violation of violations) {
      console.error(`${violation.file} - ${violation.message}`);
    }
    console.error("");
    console.error("Header template:");
    console.error(HEADER_TEMPLATE);
    console.error(HEADER_TEMPLATE_NOTE);
    return 1;
  }

  console.log("Script registry guard passed.");
  return 0;
}

function parseArgv(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[index + 1];
    else if (arg.startsWith("--root=")) options.root = arg.slice("--root=".length);
    else if (arg === "--package") options.packageFile = argv[index + 1];
    else if (arg.startsWith("--package="))
      options.packageFile = arg.slice("--package=".length);
  }
  return options;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = reportScriptRegistryViolations(
    collectScriptRegistryViolations(parseArgv(process.argv.slice(2))),
  );
}
