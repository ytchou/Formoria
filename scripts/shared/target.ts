import { spawnSync } from "node:child_process";

import { config } from "dotenv";

import { assertDatabaseTarget } from "@/lib/supabase/project-target";

export type ScriptTarget = "staging" | "production";

const ENV_FILES: Record<ScriptTarget, string> = {
  staging: ".env.staging",
  production: ".env.local",
};

export type ResolvedScriptTarget = {
  target: ScriptTarget;
  envFile: string;
  argv: string[];
};

/**
 * Reads `--target` out of an argv list without touching the environment.
 *
 * Staging is the default because an operator script that guesses wrong should
 * guess at the disposable database. The flag is stripped from the returned
 * argv so each script's own parser — several reject unknown flags — never
 * sees it.
 */
export function resolveScriptTarget(
  argv: readonly string[],
): ResolvedScriptTarget {
  const rest: string[] = [];
  let target: ScriptTarget = "staging";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let value: string | undefined;
    if (argument === "--target") {
      value = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--target=")) {
      value = argument.slice("--target=".length);
    } else {
      rest.push(argument);
      continue;
    }
    if (value !== "staging" && value !== "production") {
      throw new Error(
        `Unknown --target ${String(value)}; expected staging or production`,
      );
    }
    target = value;
  }

  return { target, envFile: ENV_FILES[target], argv: rest };
}

/** Current git branch, or null when git is unavailable or this is not a repo. */
function currentBranch(): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    });
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export type LoadScriptTargetOptions = {
  env?: Record<string, string | undefined>;
  branch?: string | null;
};

export type LoadedScriptTarget = {
  target: ScriptTarget;
  projectRef: string;
  argv: string[];
};

/**
 * Loads the env file for the resolved target and proves the credentials in it
 * belong to that project before the caller opens a client. Nothing about the
 * credentials themselves is read back or printed — only the project ref, which
 * is public and is the one fact an operator needs to see before a write.
 */
export function loadScriptTarget(
  argv: readonly string[] = process.argv.slice(2),
  options: LoadScriptTargetOptions = {},
): LoadedScriptTarget {
  const resolved = resolveScriptTarget(argv);
  const environment = options.env ?? process.env;

  config({ path: resolved.envFile, override: false, processEnv: environment });

  const { projectRef } = assertDatabaseTarget(resolved.target, environment);
  console.log(`[target] ${resolved.target} (${projectRef})`);

  if (resolved.target === "production") {
    const branch =
      options.branch === undefined ? currentBranch() : options.branch;
    if (branch && branch !== "main") {
      console.warn(
        `[target] warning: writing to production from branch ${branch}, not main`,
      );
    }
  }

  return { target: resolved.target, projectRef, argv: resolved.argv };
}
